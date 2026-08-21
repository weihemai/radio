/* ============================================================
   NOW PLAYING — three-tier fallback chain
   ============================================================
   1) Cloudflare Worker (server-side ICY metadata read) — reliable,
      works for almost any station, but depends on the worker being
      reachable.
   2) Direct-from-browser ICY read — only works for stations whose
      CORS policy happens to allow it, but costs nothing to try and
      needs no backend at all.
   3) The station's own /status-json.xsl (standard Icecast status
      page) — works for some stations even when (1) and (2) don't,
      also entirely client-side.
   If all three fail, we simply show no "now playing" line — never
   fabricate a title.

   IMPORTANT: replace NOW_PLAYING_WORKER_URL below with your own
   deployed worker URL (see the deployment instructions).
   ============================================================ */

const NOW_PLAYING_WORKER_URL = 'https://autoradio-nowplaying.martin-werthammer.workers.dev/';
const NOW_PLAYING_POLL_MS = 20000;
const NOW_PLAYING_TIMEOUT_MS = 6000;

let npTimer = null;
let npRequestId = 0;

function withTimeout(promise, ms){
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

/* ---------- tier 1: worker ---------- */
async function fetchViaWorker(streamUrl){
  if(!NOW_PLAYING_WORKER_URL || NOW_PLAYING_WORKER_URL.includes('YOUR-SUBDOMAIN')){
    throw new Error('worker URL not configured');
  }
  const res = await withTimeout(
    fetch(NOW_PLAYING_WORKER_URL + '?url=' + encodeURIComponent(streamUrl)),
    NOW_PLAYING_TIMEOUT_MS
  );
  if(!res.ok) throw new Error('worker http ' + res.status);
  const data = await res.json();
  if(data.error) throw new Error(data.error);
  if(!data.title) throw new Error('worker returned no title');
  return data;
}

/* ---------- tier 2: direct browser ICY read (best-effort) ---------- */
async function fetchViaDirectIcy(streamUrl){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOW_PLAYING_TIMEOUT_MS);
  try{
    const res = await fetch(streamUrl, { headers: { 'Icy-MetaData': '1' }, signal: controller.signal });
    const metaintHeader = res.headers.get('icy-metaint');
    if(!metaintHeader) throw new Error('no icy-metaint (likely CORS-restricted)');
    const metaint = parseInt(metaintHeader, 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    const needed = metaint + 1 + 255 * 16;
    while(received < needed){
      const { done, value } = await reader.read();
      if(done) break;
      chunks.push(value);
      received += value.length;
    }
    reader.cancel().catch(() => {});
    if(received <= metaint) throw new Error('stream too short');
    const buf = new Uint8Array(received);
    let off = 0;
    for(const c of chunks){ buf.set(c, off); off += c.length; }
    const metaLen = buf[metaint] * 16;
    if(!metaLen) throw new Error('empty metadata block');
    const metaStr = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(metaint + 1, metaint + 1 + metaLen));
    const match = metaStr.match(/StreamTitle='([^']*)'/);
    if(!match || !match[1].trim()) throw new Error('no StreamTitle');
    const raw = match[1].trim();
    const parts = raw.split(' - ');
    return parts.length >= 2
      ? { raw, artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
      : { raw, artist: null, title: raw };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- tier 3: station's own status-json.xsl ---------- */
async function fetchViaStatusJson(streamUrl){
  const origin = new URL(streamUrl).origin;
  const res = await withTimeout(fetch(origin + '/status-json.xsl'), NOW_PLAYING_TIMEOUT_MS);
  if(!res.ok) throw new Error('status-json http ' + res.status);
  const data = await res.json();
  const src = data && data.icestats && data.icestats.source;
  const sources = Array.isArray(src) ? src : (src ? [src] : []);
  const match = sources.find(s => s.title) || sources[0];
  if(!match || !match.title) throw new Error('no title in status-json');
  const raw = String(match.title).trim();
  const parts = raw.split(' - ');
  return parts.length >= 2
    ? { raw, artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
    : { raw, artist: null, title: raw };
}

/* ---------- orchestrator: try each tier in order ---------- */
async function fetchNowPlaying(streamUrl){
  const tiers = [fetchViaWorker, fetchViaDirectIcy, fetchViaStatusJson];
  for(const tier of tiers){
    try{
      const result = await tier(streamUrl);
      if(result && result.title) return result;
    }catch(e){ /* fall through to next tier */ }
  }
  return null;
}

/* ============================================================
   POLLING — starts/stops alongside playback. Station switches
   invalidate any in-flight request via the request-id guard, so a
   slow tier-3 lookup from a previous station can never overwrite the
   UI for whatever is now playing.
   ============================================================ */
function startNowPlayingPolling(station){
  stopNowPlayingPolling();
  const myId = ++npRequestId;

  const poll = async () => {
    if(myId !== npRequestId) return;
    const result = await fetchNowPlaying(station.url);
    if(myId !== npRequestId) return; // station changed while we were waiting
    if(result){
      updateNowPlayingUI(station, result);
    } else {
      clearNowPlayingUI(station);
    }
  };

  poll();
  npTimer = setInterval(poll, NOW_PLAYING_POLL_MS);
}

function stopNowPlayingPolling(){
  npRequestId++; // invalidates any in-flight poll from the previous station
  if(npTimer){ clearInterval(npTimer); npTimer = null; }
}

/* ============================================================
   UI + MediaSession
   Updates both our own player tile and the OS/vehicle-level media
   widget (the one shown bottom-left in the car's own UI), via the
   standard MediaSession API — steering-wheel / hardware play-pause
   controls then work automatically too.
   ============================================================ */
function updateNowPlayingUI(station, npResult){
  const el = document.getElementById('nowPlaying');
  if(el){
    const text = npResult.artist ? `${npResult.artist} — ${npResult.title}` : npResult.title;
    el.textContent = text;
    el.style.display = 'block';
  }
  updateMediaSession(station, npResult);
}

function clearNowPlayingUI(station){
  const el = document.getElementById('nowPlaying');
  if(el){ el.style.display = 'none'; el.textContent = ''; }
  updateMediaSession(station, null);
}

function updateMediaSession(station, npResult){
  if(!('mediaSession' in navigator) || !station) return;
  try{
    navigator.mediaSession.metadata = new MediaMetadata({
      title: npResult ? npResult.title : station.name,
      artist: npResult && npResult.artist ? npResult.artist : station.name,
      album: station.name,
      artwork: [
        { src: stationLogo(station), sizes: '256x256', type: 'image/png' },
        { src: stationLogo(station), sizes: '512x512', type: 'image/png' }
      ]
    });
  }catch(e){ /* MediaMetadata not supported in this browser: ignore */ }
}

/* ============================================================
   ON-DEVICE DIAGNOSTICS
   Runs each fallback tier individually against a stream URL and
   reports exactly what happened at each step — designed to be read
   directly on the car's screen, since opening real devtools inside
   an embedded vehicle browser usually isn't possible. This is the
   fastest way to pin down *why* a given environment fails: wrong
   worker URL, worker unreachable (network/CSP block), worker reached
   but errored, CORS block on the direct-ICY attempt, etc.
   ============================================================ */
async function runNowPlayingDiagnostics(streamUrl){
  const results = [];

  results.push({ tier: 'Worker-URL konfiguriert?', ok: !!(NOW_PLAYING_WORKER_URL && !NOW_PLAYING_WORKER_URL.includes('YOUR-SUBDOMAIN')), detail: NOW_PLAYING_WORKER_URL });

  // Tier 1: worker — capture the raw failure reason (network error vs
  // HTTP status vs JSON parse error vs worker-reported error) since
  // each points to a different root cause.
  try{
    const t0 = Date.now();
    const res = await fetch(NOW_PLAYING_WORKER_URL + '?url=' + encodeURIComponent(streamUrl));
    const ms = Date.now() - t0;
    let bodyText = await res.text();
    let parsed = null;
    try{ parsed = JSON.parse(bodyText); }catch(e){ /* not JSON */ }
    if(!res.ok){
      results.push({ tier: '1) Worker', ok:false, detail:`HTTP ${res.status} nach ${ms}ms — Worker erreicht, aber Fehler zurückgegeben. Antwort: ${bodyText.slice(0,150)}` });
    } else if(parsed && parsed.error){
      results.push({ tier: '1) Worker', ok:false, detail:`Worker erreicht (${ms}ms), meldet aber: "${parsed.error}" — meist heißt das, der Sender selbst liefert keine ICY-Metadaten.` });
    } else if(parsed && parsed.title){
      results.push({ tier: '1) Worker', ok:true, detail:`OK nach ${ms}ms: "${parsed.title}"` });
    } else {
      results.push({ tier: '1) Worker', ok:false, detail:`Antwort war kein gültiges JSON mit Titel (${ms}ms). Rohantwort: ${bodyText.slice(0,150)}` });
    }
  }catch(e){
    // A raw network-level failure here (TypeError: Failed to fetch, or a
    // SecurityError) most often means the request never left the device:
    // a Content-Security-Policy or a domain whitelist in the car's
    // browser container is blocking calls to workers.dev entirely.
    results.push({ tier: '1) Worker', ok:false, detail:`Netzwerkfehler, Request kam nie an: "${e.message}". Typischer Grund: die Auto-Browser-Umgebung blockiert Verbindungen zu workers.dev (CSP/Domain-Whitelist) unabhängig vom normalen Internetzugang.` });
  }

  // Tier 2: direct ICY
  try{
    const t0 = Date.now();
    const result = await fetchViaDirectIcy(streamUrl);
    results.push({ tier: '2) Direkter Browser-Versuch', ok:true, detail:`OK nach ${Date.now()-t0}ms: "${result.title}"` });
  }catch(e){
    results.push({ tier: '2) Direkter Browser-Versuch', ok:false, detail: e.message });
  }

  // Tier 3: status-json.xsl
  try{
    const t0 = Date.now();
    const result = await fetchViaStatusJson(streamUrl);
    results.push({ tier: '3) status-json.xsl', ok:true, detail:`OK nach ${Date.now()-t0}ms: "${result.title}"` });
  }catch(e){
    results.push({ tier: '3) status-json.xsl', ok:false, detail: e.message });
  }

  return results;
}
