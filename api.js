/* ============================================================
   Radio-Browser API wrapper
   Free, open, no API key needed: https://www.radio-browser.info
   Uses a list of known mirror servers with automatic failover,
   since any single mirror can be temporarily unreachable
   (this also matters for regions where some mirrors are blocked).
   ============================================================ */

/* ============================================================
   Radio-Browser API wrapper
   Free, open, no API key needed: https://www.radio-browser.info
   Uses a list of known mirror servers with automatic failover,
   since any single mirror can be temporarily unreachable
   (this also matters for regions where some mirrors are blocked).

   NOTE on Asia/China mirrors: as of research at build time, the
   radio-browser.info project only operates servers in Europe
   (Germany, Austria, Netherlands). There is currently no official
   Hong Kong/China/Singapore mirror. We still fetch the live mirror
   list at startup (in case that changes) and always race the
   fastest-responding server, which is the best available approach
   from a network without a nearby mirror.
   ============================================================ */

const RADIO_API_FALLBACK_SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info'
];

let RADIO_API_SERVERS = [...RADIO_API_FALLBACK_SERVERS];
let activeServerIndex = 0;
let serversDiscovered = false;

/* Discover the live mirror list and pick whichever responds fastest.
   Falls back silently to the static list above if this fails
   (e.g. no network, or DNS-based discovery unsupported). */
async function discoverFastestServer(){
  try{
    const res = await fetch('https://all.api.radio-browser.info/json/servers', { cache:'no-store' });
    if(res.ok){
      const list = await res.json();
      const names = [...new Set(list.map(s => 'https://' + s.name))];
      if(names.length) RADIO_API_SERVERS = names;
    }
  }catch(e){ /* keep fallback list */ }

  // Race all candidates with a lightweight request, use the winner first.
  try{
    const race = RADIO_API_SERVERS.map((base, idx) =>
      fetch(base + '/json/stats', { cache:'no-store' }).then(r => r.ok ? idx : Promise.reject())
    );
    const winnerIdx = await Promise.any(race);
    activeServerIndex = winnerIdx;
  }catch(e){ /* no server answered the race; keep index 0 */ }

  serversDiscovered = true;
}
const serverDiscoveryPromise = discoverFastestServer();

let preferEuOnly = false;
function setPreferEuServersOnly(value){
  preferEuOnly = value;
  if(value){
    RADIO_API_SERVERS = [...RADIO_API_FALLBACK_SERVERS];
    activeServerIndex = 0;
  }
  // "auto" mode: the next apiFetch call will re-race via serverDiscoveryPromise's
  // already-resolved result; a page reload re-runs the full discovery race.
}

async function apiFetch(path, onProgress){
  await serverDiscoveryPromise; // make sure we've picked the fastest server first
  let lastError = null;
  for(let i=0; i<RADIO_API_SERVERS.length; i++){
    const idx = (activeServerIndex + i) % RADIO_API_SERVERS.length;
    const base = RADIO_API_SERVERS[idx];
    try{
      const res = await fetch(base + path, {
        headers: { 'User-Agent': 'AutoradioApp/1.0' }
      });
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const data = await readJsonWithProgress(res, onProgress);
      activeServerIndex = idx; // remember the working server for next calls
      return data;
    }catch(err){
      lastError = err;
      continue; // try next mirror
    }
  }
  throw lastError || new Error('Alle API-Server nicht erreichbar');
}

/* Stream the response body so we can report real download progress
   when the server provides a Content-Length header. When it doesn't
   (chunked responses are common here), onProgress is called with
   null to signal "indeterminate" so the UI can show a moving bar
   instead of a stalled one. */
async function readJsonWithProgress(res, onProgress){
  if(!res.body || !onProgress){
    return res.json();
  }
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while(true){
    const { done, value } = await reader.read();
    if(done) break;
    chunks.push(value);
    received += value.length;
    onProgress(total ? received/total : null, received, total);
  }
  const blob = new Blob(chunks);
  const text = await blob.text();
  return JSON.parse(text);
}

/* Normalize a raw radio-browser station object into the shape the UI uses */
function normalizeStation(s){
  return {
    uuid: s.stationuuid,
    name: s.name ? s.name.trim() : 'Unbenannt',
    url: s.url_resolved || s.url,
    favicon: s.favicon || '',
    tags: (s.tags || '').split(',').map(x=>x.trim()).filter(Boolean).slice(0,3).join(', '),
    country: s.country || '',
    countryCode: s.countrycode || '',
    language: s.language || '',
    votes: s.votes || 0,
    bitrate: s.bitrate || 0
  };
}

async function searchStations({ name, country, countryExact, tag, language, limit=100, order='votes', onProgress } = {}){
  const params = new URLSearchParams();
  if(name) params.set('name', name);
  if(country) params.set('country', country);
  if(countryExact) params.set('countryExact', 'true');
  if(tag) params.set('tag', tag);
  if(language) params.set('language', language);
  params.set('hidebroken', 'true');
  params.set('order', order);
  params.set('reverse', 'true');
  params.set('limit', String(limit));
  const raw = await apiFetch('/json/stations/search?' + params.toString(), onProgress);
  return raw.map(normalizeStation);
}

async function getTopStations(limit=50, onProgress){
  const raw = await apiFetch('/json/stations/topvote?limit=' + limit, onProgress);
  return raw.map(normalizeStation);
}

async function getCountries(){
  const raw = await apiFetch('/json/countries');
  return raw
    .filter(c => c.name && c.stationcount > 0)
    .sort((a,b)=> b.stationcount - a.stationcount);
}

async function getTags(){
  // No `limit` param at all: sending limit=0 actually means "return zero
  // rows" on this API (it's SQL-backed), which was silently emptying the
  // Genre/Music screen. Omitting the param lets the server use its own
  // default, which returns the full tag list.
  const raw = await apiFetch('/json/tags');
  return raw
    .filter(t => t.name && t.stationcount > 3)
    .sort((a,b)=> b.stationcount - a.stationcount);
}

async function getLanguages(){
  const raw = await apiFetch('/json/languages');
  return raw
    .filter(l => l.name && l.stationcount > 3)
    .sort((a,b)=> b.stationcount - a.stationcount);
}

/* Register a listen with the API (courtesy call, non-blocking, ignore failures) */
function registerClick(uuid){
  if(!uuid) return;
  const base = RADIO_API_SERVERS[activeServerIndex];
  fetch(base + '/json/url/' + uuid, { method:'POST' }).catch(()=>{});
}
