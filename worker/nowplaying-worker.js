/**
 * Autoradio "Now Playing" Worker
 * ---------------------------------------------------------------
 * Deployed on Cloudflare Workers (free tier). GitHub Pages can only
 * serve static files, so this tiny serverless function does the one
 * thing a static page can't: open a live connection to an Icecast/
 * Shoutcast stream, read the embedded ICY metadata (song title), and
 * hand back just the parsed result as JSON.
 *
 * Usage from the app:
 *   GET https://<your-worker>.workers.dev/?url=<url-encoded stream url>
 *   -> { "title": "...", "artist": "...", "raw": "Artist - Title" }
 *   or { "error": "..." } if the stream doesn't expose ICY metadata.
 *
 * How ICY metadata works (why this can't be done from a static page):
 * When a client sends the header `Icy-MetaData: 1`, the server inserts
 * a metadata block every `icy-metaint` bytes of audio data. That block
 * starts with 1 length byte (value * 16 = byte length), followed by an
 * ASCII string containing `StreamTitle='Artist - Song';...`. Reading
 * this requires holding open a raw streaming connection and parsing
 * binary data — something a plain <audio> tag never exposes to the
 * page, and something most stream servers don't allow across origins
 * from the browser directly (see the client-side fallback for when it
 * does work).
 */

const REQUEST_TIMEOUT_MS = 8000;

function corsHeaders(){
  return {
    'Access-Control-Allow-Origin': '*', // tighten to your GitHub Pages origin if you want
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };
}

function jsonResponse(obj, status = 200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

function concatChunks(chunks, total){
  const buf = new Uint8Array(total);
  let offset = 0;
  for(const c of chunks){ buf.set(c, offset); offset += c.length; }
  return buf;
}

async function readIcyMetadata(streamUrl){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try{
    res = await fetch(streamUrl, {
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': 'Mozilla/5.0 (compatible; AutoradioNowPlayingWorker/1.0)'
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if(!res.ok){
    throw new Error('Stream responded with HTTP ' + res.status);
  }

  const metaintHeader = res.headers.get('icy-metaint');
  if(!metaintHeader){
    // Either not an Icecast/Shoutcast stream, or it doesn't support
    // ICY metadata injection (some just serve raw audio / playlists).
    throw new Error('Stream has no icy-metaint header (no live metadata available)');
  }
  const metaint = parseInt(metaintHeader, 10);
  if(!Number.isFinite(metaint) || metaint <= 0 || metaint > 5_000_000){
    throw new Error('Invalid icy-metaint value');
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  // Worst case: the audio block itself, plus the 1 length byte, plus
  // the largest possible metadata block (255 * 16 bytes).
  const needed = metaint + 1 + 255 * 16;

  try{
    while(received < needed){
      const { done, value } = await reader.read();
      if(done) break;
      chunks.push(value);
      received += value.length;
    }
  } finally {
    // We only ever need one metadata block — close the connection
    // immediately instead of continuing to stream audio we don't use.
    reader.cancel().catch(() => {});
  }

  if(received <= metaint){
    throw new Error('Stream closed before any metadata block arrived');
  }

  const buf = concatChunks(chunks, received);
  const metaLenByte = buf[metaint];
  const metaLen = metaLenByte * 16;
  if(metaLen === 0){
    throw new Error('Station sent an empty metadata block (no title currently set)');
  }
  if(metaint + 1 + metaLen > buf.length){
    throw new Error('Metadata block was truncated');
  }

  const metaBytes = buf.slice(metaint + 1, metaint + 1 + metaLen);
  const metaStr = new TextDecoder('utf-8', { fatal: false }).decode(metaBytes);
  const match = metaStr.match(/StreamTitle='([^']*)'/);
  if(!match || !match[1].trim()){
    throw new Error('No StreamTitle found in metadata block');
  }

  const raw = match[1].trim();
  const parts = raw.split(' - ');
  if(parts.length >= 2){
    return { raw, artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { raw, artist: null, title: raw };
}

export default {
  async fetch(request){
    if(request.method === 'OPTIONS'){
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const streamUrl = url.searchParams.get('url');
    if(!streamUrl){
      return jsonResponse({ error: 'Missing required "url" query parameter' }, 400);
    }
    let parsed;
    try{ parsed = new URL(streamUrl); }
    catch{ return jsonResponse({ error: 'Invalid stream URL' }, 400); }
    if(parsed.protocol !== 'http:' && parsed.protocol !== 'https:'){
      return jsonResponse({ error: 'Only http(s) stream URLs are supported' }, 400);
    }

    try{
      const meta = await readIcyMetadata(streamUrl);
      return jsonResponse(meta);
    }catch(err){
      return jsonResponse({ error: String(err && err.message || err) }, 502);
    }
  }
};
