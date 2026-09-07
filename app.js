/* ============================================================
   Autoradio App — main logic
   Static app: no backend, no build step.
   Persists favorites, recent stations, and settings in localStorage.

   VERSIONING: bump APP_VERSION on every meaningful change from here on
   (semver-ish: MAJOR.MINOR.PATCH — patch for fixes, minor for new
   features, major for breaking/structural changes). This is the only
   place the number lives; both the header title and the Settings
   "About" section read it from here.
   ============================================================ */

const APP_VERSION = '1.7.1';

const STORAGE_KEYS = {
  favorites: 'autoradio_favorites',
  recent: 'autoradio_recent'
};

/* ---------- persistence helpers ---------- */
function loadJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){ return fallback; }
}
function saveJSON(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){ /* storage full/unavailable: ignore */ }
}

/* ---------- state ---------- */
let favorites = loadJSON(STORAGE_KEYS.favorites, []);
let recentStations = loadJSON(STORAGE_KEYS.recent, []);
let currentStation = null;   // normalized station object currently loaded in the player

/* Navigation is a stack of "levels". Each level caches its own item list,
   so going Back never needs to re-fetch from the API — it just re-renders
   the previous level's cached items. All items of a level are rendered at
   once into a natively-scrollable container (no manual pagination). */
let navStack = [];
let idleTimer = null;
let searchDebounce = null;
let searchResults = [];

const audio = document.getElementById('audio');
const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
const ICON_PAUSE = '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>';

/* ---------- placeholder logo ---------- */
function placeholderLogo(name, seed){
  const colors = ['#1db954','#e6007e','#e2001a','#f2b400','#274690','#008c45','#aa151b','#00a0dc','#8dc63f','#f7941e'];
  const idx = Math.abs(hashCode(seed || name)) % colors.length;
  const initials = (name || '?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='${colors[idx]}'/><text x='50' y='58' font-size='34' fill='white' text-anchor='middle' font-family='Helvetica' font-weight='bold'>${initials}</text></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}
function hashCode(str){
  let hash = 0;
  for(let i=0;i<str.length;i++){ hash = ((hash<<5)-hash) + str.charCodeAt(i); hash |= 0; }
  return hash;
}
function stationLogo(station){
  return station.favicon && station.favicon.startsWith('http') ? station.favicon : placeholderLogo(station.name, station.uuid);
}

/* ---------- approximate country -> IANA timezone lookup ---------- */
const COUNTRY_TZ = {
  DE:"Europe/Berlin", AT:"Europe/Vienna", CH:"Europe/Zurich", FR:"Europe/Paris",
  ES:"Europe/Madrid", IT:"Europe/Rome", PT:"Europe/Lisbon", NL:"Europe/Amsterdam",
  BE:"Europe/Brussels", GB:"Europe/London", IE:"Europe/Dublin", PL:"Europe/Warsaw",
  SE:"Europe/Stockholm", NO:"Europe/Oslo", DK:"Europe/Copenhagen", FI:"Europe/Helsinki",
  GR:"Europe/Athens", CZ:"Europe/Prague", HU:"Europe/Budapest", RO:"Europe/Bucharest",
  RU:"Europe/Moscow", TR:"Europe/Istanbul", US:"America/New_York", CA:"America/Toronto",
  MX:"America/Mexico_City", BR:"America/Sao_Paulo", AR:"America/Argentina/Buenos_Aires",
  JP:"Asia/Tokyo", CN:"Asia/Shanghai", KR:"Asia/Seoul", IN:"Asia/Kolkata",
  AU:"Australia/Sydney", NZ:"Pacific/Auckland", ZA:"Africa/Johannesburg",
  AE:"Asia/Dubai", SA:"Asia/Riyadh", EG:"Africa/Cairo", SG:"Asia/Singapore",
  TH:"Asia/Bangkok", ID:"Asia/Jakarta", PH:"Asia/Manila", VN:"Asia/Ho_Chi_Minh",
  HK:"Asia/Hong_Kong", TW:"Asia/Taipei"
};
function tzForStation(station){
  if(!station) return null;
  return COUNTRY_TZ[(station.countryCode||'').toUpperCase()] || null;
}

/* ---------- country -> continent grouping (for the "Land" hierarchy) ---------- */
const CONTINENTS = {
  "Europa": ["DE","AT","CH","FR","ES","IT","PT","NL","BE","GB","IE","PL","SE","NO","DK","FI","GR","CZ","HU","RO","RU","TR","UA","SK","HR","RS","BG","LT","LV","EE","IS","LU","MT","CY","SI","AL","BA","MK","MD","ME","XK"],
  "Nordamerika": ["US","CA","MX"],
  "Südamerika": ["BR","AR","CL","CO","PE","VE","EC","UY","PY","BO"],
  "Asien": ["JP","CN","KR","IN","SG","TH","ID","PH","VN","HK","TW","MY","PK","BD","IL","SA","AE","QA","KW"],
  "Ozeanien": ["AU","NZ","FJ"],
  "Afrika": ["ZA","EG","NG","KE","MA","GH","TN","DZ"]
};
function continentForCountryCode(code){
  code = (code||'').toUpperCase();
  for(const [continent, codes] of Object.entries(CONTINENTS)){
    if(codes.includes(code)) return continent;
  }
  return 'Andere';
}

/* ============================================================
   CLOCK — top bar always shows local system time ("hier vor Ort").
   Player shows the station's local time + location underneath.
   ============================================================ */
function tickClocks(){
  const now = new Date();
  document.getElementById('clockTime').textContent =
    String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');

  const localTimeEl = document.getElementById('playerLocalTime');
  if(currentStation){
    const tz = tzForStation(currentStation);
    if(tz){
      try{
        const stTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
        const hh = String(stTime.getHours()).padStart(2,'0');
        const mm = String(stTime.getMinutes()).padStart(2,'0');
        const place = currentStation.country || tz.split('/').pop().replace('_',' ');
        localTimeEl.textContent = `${hh}:${mm} · ${place}`;
        localTimeEl.style.display = 'block';
      }catch(e){ localTimeEl.style.display = 'none'; }
    } else {
      localTimeEl.style.display = 'none';
    }
  } else {
    localTimeEl.style.display = 'none';
  }
}
setInterval(tickClocks, 1000*10);
tickClocks();

/* ============================================================
   IDLE TIMEOUT — 10s without touch/click while inside a
   sub-screen returns to the home grid.
   ============================================================ */
function resetIdleTimer(){
  if(idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(()=>{
    if(navStack.length>0 || document.getElementById('searchWrap').style.display==='flex') goHome();
  }, 20000);
}
['click','touchstart','touchmove','keydown'].forEach(evt=>{
  document.getElementById('app').addEventListener(evt, resetIdleTimer);
});
resetIdleTimer();

/* ============================================================
   FAVORITES — fixed-height row, native horizontal smooth-scroll.
   Always renders every favorite; the browser scrolls, no JS paging.
   ============================================================ */
function renderFavs(){
  const row = document.getElementById('favRow');
  row.innerHTML = '';
  if(favorites.length === 0){
    const empty = document.createElement('div');
    empty.className = 'fav-empty';
    empty.textContent = t('noFavorites');
    row.appendChild(empty);
    return;
  }
  favorites.forEach(f=>{
    const tile = document.createElement('div');
    tile.className = 'fav-tile';
    const cover = document.createElement('div');
    cover.className = 'cover';
    cover.style.backgroundImage = `url(${JSON.stringify(stationLogo(f))})`;
    const label = document.createElement('div');
    label.className = 'flabel';
    label.textContent = f.name;
    tile.appendChild(cover);
    tile.appendChild(label);
    tile.addEventListener('click', ()=> play(f));
    row.appendChild(tile);
  });
}
function isFavorite(station){
  return station && favorites.some(f => f.uuid === station.uuid || f.url === station.url);
}
function toggleFavorite(station){
  if(!station) return;
  const idx = favorites.findIndex(f => f.uuid === station.uuid || f.url === station.url);
  if(idx >= 0) favorites.splice(idx,1);
  else favorites.push(station);
  saveJSON(STORAGE_KEYS.favorites, favorites);
  renderFavs();
  updateStarBtn();
}
function clearAllFavorites(){
  favorites = [];
  saveJSON(STORAGE_KEYS.favorites, favorites);
  renderFavs();
  updateStarBtn();
}

/* ---------- recently played ---------- */
function pushRecent(station){
  recentStations = recentStations.filter(s => s.uuid !== station.uuid);
  recentStations.unshift(station);
  recentStations = recentStations.slice(0, 20);
  saveJSON(STORAGE_KEYS.recent, recentStations);
}

/* ============================================================
   PLAYER — full-width bar; the whole bar toggles play/pause.
   Star button on the left toggles favorite status.

   The play/pause icon itself already communicates playing vs. paused,
   so we don't duplicate that in a text line. While a stream is
   connecting, the icon is replaced by a spinning ring instead of a
   "Lädt…" label — one less text line, and a more familiar pattern.
   The status text element is kept only for the rare "stream
   unreachable" error, where a short message is actually useful.

   "Now playing" (song/show title): fetched via the three-tier fallback
   chain in nowplaying.js (Cloudflare Worker -> direct browser ICY read
   -> station's own status-json.xsl). Shown both in this bar and, via
   the MediaSession API, in the vehicle's own native media widget.
   ============================================================ */
function showLoadingSpinner(){
  document.getElementById('playIcon').style.display = 'none';
  document.getElementById('loadingSpinner').style.display = 'block';
}
function hideLoadingSpinner(){
  document.getElementById('playIcon').style.display = 'block';
  document.getElementById('loadingSpinner').style.display = 'none';
}
function setStatusError(text){
  const el = document.getElementById('stationStatus');
  if(text){ el.textContent = text; el.style.display = 'block'; }
  else { el.textContent = ''; el.style.display = 'none'; }
}

// ---- China Great-Firewall fallback: only retried through the proxy if the
// direct stream fails or never starts, and only when the user has opted in
// via Settings (chinaProxySeg) — never the default path, to conserve the
// proxy's tight Render.com bandwidth budget.
const AUDIO_START_TIMEOUT_MS = 9000;
let audioStartTimer = null;
let proxyFallbackUuid = null; // uuid of the station currently loaded via the proxy, if any

function chinaProxyEnabled(){
  return localStorage.getItem('autoradio_china_proxy') === 'on';
}
function proxyStreamUrl(url){
  const u = new URL(NOW_PLAYING_WORKER_URL + '/stream');
  u.searchParams.set('url', url);
  u.username = localStorage.getItem('autoradio_proxy_user') || '';
  u.password = localStorage.getItem('autoradio_proxy_pass') || '';
  return u.toString();
}
function setProxyBadge(visible){
  document.getElementById('proxyBadge').style.display = visible ? 'inline-block' : 'none';
}
function attemptProxyFallback(station){
  if(!chinaProxyEnabled() || proxyFallbackUuid === station.uuid){
    // Either the user hasn't opted in, or the proxy attempt itself just
    // failed/timed out too — give up and show the normal error.
    hideLoadingSpinner();
    setStatusError(t('unreachable'));
    setProxyBadge(false);
    return;
  }
  proxyFallbackUuid = station.uuid;
  setProxyBadge(true);
  audio.src = proxyStreamUrl(station.url);
  audio.play().catch(()=>{}); // failure surfaces via the 'error' listener or the timer below
  clearTimeout(audioStartTimer);
  audioStartTimer = setTimeout(()=>attemptProxyFallback(station), AUDIO_START_TIMEOUT_MS);
}

function play(station){
  currentStation = station;
  proxyFallbackUuid = null;
  setProxyBadge(false);
  document.getElementById('stationName').textContent = station.name;
  setStatusError(null);
  clearNowPlayingUI(station);
  showLoadingSpinner();

  const art = document.getElementById('playerArt');
  art.innerHTML = `<img src="${stationLogo(station)}" onerror="this.src='${placeholderLogo(station.name, station.uuid)}'">`;

  audio.src = station.url;
  audio.play().then(()=>{
    hideLoadingSpinner();
    document.getElementById('playIcon').innerHTML = ICON_PAUSE;
    setMediaSessionPlaybackState('playing');
  }).catch(e=>console.warn('play() failed', e));
  // Failure is detected via the 'error' listener below (and the timeout),
  // not here — play() can also reject for reasons unrelated to the stream
  // itself (e.g. an autoplay-policy block), which must not trigger a proxy
  // fallback attempt.
  clearTimeout(audioStartTimer);
  audioStartTimer = setTimeout(()=>attemptProxyFallback(station), AUDIO_START_TIMEOUT_MS);

  updateStarBtn();
  tickClocks();
  pushRecent(station);
  registerClick(station.uuid);
  updateMediaSession(station, null); // shows station name immediately; polling refines it
  startNowPlayingPolling(station);
}

document.getElementById('playerBar').addEventListener('click', (e)=>{
  if(e.target.closest('#starBtn')) return;
  if(!currentStation) return;
  if(audio.paused){
    audio.play();
    document.getElementById('playIcon').innerHTML = ICON_PAUSE;
    setStatusError(null);
    setMediaSessionPlaybackState('playing');
  } else {
    audio.pause();
    document.getElementById('playIcon').innerHTML = ICON_PLAY;
    setMediaSessionPlaybackState('paused');
  }
});
audio.addEventListener('waiting', showLoadingSpinner);
audio.addEventListener('playing', ()=>{ clearTimeout(audioStartTimer); hideLoadingSpinner(); });
audio.addEventListener('error', ()=>{
  clearTimeout(audioStartTimer);
  if(currentStation) attemptProxyFallback(currentStation);
  else { hideLoadingSpinner(); setStatusError(t('unreachable')); }
});

function setMediaSessionPlaybackState(state){
  if('mediaSession' in navigator){
    try{ navigator.mediaSession.playbackState = state; }catch(e){}
  }
}
if('mediaSession' in navigator){
  try{
    navigator.mediaSession.setActionHandler('play', ()=>{ document.getElementById('playerBar').click(); });
    navigator.mediaSession.setActionHandler('pause', ()=>{ document.getElementById('playerBar').click(); });
  }catch(e){ /* some browsers don't support all action handlers: ignore */ }
}

function updateStarBtn(){
  document.getElementById('starBtn').classList.toggle('active', isFavorite(currentStation));
}
document.getElementById('starBtn').addEventListener('click', (e)=>{
  e.stopPropagation();
  toggleFavorite(currentStation);
});

/* ============================================================
   HEADER LOADING INDICATOR — thin progress bar under the topbar.
   Lives outside the scrollable content flow, so it never shifts
   the grid layout while loading.
   ============================================================ */
function setLoadingStatus(text){
  const el = document.getElementById('headerStatusLabel');
  el.textContent = text;
  el.classList.toggle('show', !!text);
}

async function withLoading(promiseOrValue){
  const track = document.getElementById('headerProgressTrack');
  const err = document.getElementById('errorBox');
  err.style.display = 'none';
  track.style.display = 'block';
  setApiStatusListener((phase)=>{
    setLoadingStatus(phase === 'connecting' ? t('connectingMsg') : t('connectedLoadingMsg'));
  });
  try{
    const result = await promiseOrValue;
    track.style.display = 'none';
    return result;
  }catch(e){
    track.style.display = 'none';
    err.style.display = 'block';
    err.textContent = t('loadError');
    throw e;
  }finally{
    setApiStatusListener(null);
    setLoadingStatus('');
  }
}

/* ============================================================
   HOME GRID actions
   ============================================================ */
document.querySelectorAll('#homeGrid .tile').forEach(tile=>{
  tile.addEventListener('click', ()=> handleHomeAction(tile.dataset.action));
});

async function handleHomeAction(action){
  switch(action){
    case 'land': return openCountryContinents();
    case 'sprache': return openAlphabeticGroups(t('language'), await withLoading(getLanguages()), l => ({ filter:{ language:l.name } }));
    case 'alle': return openStationLevel(t('allStations'), await withLoading(getTopStations(200)));
    case 'recent': return openStationLevel(t('recent'), recentStations);
    case 'suche': return openSearch();
  }
}

function capitalize(s){
  return (s || '')
    .replace(/^[#\-_.\s]+/, '')          // strip leading junk like "#"
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/* ============================================================
   NAVIGATION LEVELS
   Every screen we push stores its own item list so Back never
   needs a network round-trip — it just re-renders what's cached.
   ============================================================ */
function pushLevel(title, items){
  navStack.push({ title, items });
  renderCurrentLevel();
}
function renderCurrentLevel(){
  showScreen('results');
  renderBreadcrumb();
  renderResultsGrid();
}
function currentLevel(){
  return navStack[navStack.length-1];
}

/* ---------- Land: Kontinent -> Land -> Sender ---------- */
async function openCountryContinents(){
  const countries = await withLoading(getCountries());
  const groups = {};
  countries.forEach(c=>{
    const continent = continentForCountryCode(c.iso_3166_1);
    (groups[continent] = groups[continent] || []).push(c);
  });
  const items = Object.keys(groups).sort().map(continent => ({
    kind:'category',
    title: continent,
    onOpen: ()=>{
      const countryItems = groups[continent]
        .sort((a,b)=> b.stationcount - a.stationcount)
        .map(c => ({
          kind:'category',
          title: c.name,
          onOpen: async ()=>{
            const stations = await withLoading(searchStations({ country:c.name, countryExact:true, limit:150 }));
            pushLevel(c.name, stationItems(stations));
          }
        }));
      pushLevel(continent, countryItems);
    }
  }));
  navStack = [];
  pushLevel(t('country'), items);
}

/* ---------- Genre / Sprache: A-Z Gruppe -> Tag/Sprache -> Sender ----------
   Fetches the FULL tag/language list (no server-side limit) so every
   letter range is actually populated — previously a small `limit` on
   the API call combined with the endpoint's default alphabetical
   ordering meant only the first ~60 entries (roughly "A-D") ever
   arrived, which is why entire ranges looked empty. */
function openAlphabeticGroups(title, entries, mapFn){
  const groups = {};
  const ranges = [['0','9'],['A','D'],['E','H'],['I','L'],['M','P'],['Q','T'],['U','Z']];
  function rangeLabel(letter){
    const L = (letter||'A').toUpperCase();
    if(L >= '0' && L <= '9') return '0-9';
    const r = ranges.find(([a,b]) => a!=='0' && L >= a && L <= b);
    return r ? (r[0] + '-' + r[1]) : 'A-D';
  }
  entries.forEach(e=>{
    const clean = capitalize(e.name); // strips "#", underscores, capitalizes each word
    const label = rangeLabel(clean[0]);
    (groups[label] = groups[label] || []).push({ ...e, cleanName: clean || e.name });
  });
  const order = ranges.map(r=> r[0]+'-'+r[1]).filter(l=> groups[l]);
  const items = order.map(label => ({
    kind:'category',
    title: label,
    onOpen: ()=>{
      const subItems = groups[label]
        .sort((a,b)=> b.stationcount - a.stationcount)
        .map(e=>{
          const meta = mapFn(e);
          return {
            kind:'category',
            title: e.cleanName,
            onOpen: async ()=>{
              const stations = await withLoading(searchStations({ ...meta.filter, limit:150 }));
              pushLevel(e.cleanName, stationItems(stations));
            }
          };
        });
      pushLevel(label, subItems);
    }
  }));
  navStack = [];
  pushLevel(title, items);
}

/* ---------- flat station level (Alle Sender, Nachrichten, Talk, Zuletzt gehört) ---------- */
function openStationLevel(title, stations){
  navStack = [];
  pushLevel(title, stationItems(stations));
}
function stationItems(stations){
  return stations.map(s => ({ kind:'station', station:s }));
}

function renderBreadcrumb(){
  const box = document.getElementById('breadcrumbBox');
  if(navStack.length === 0){ box.style.display = 'none'; box.innerHTML=''; return; }
  box.style.display = 'flex';
  box.innerHTML = '';
  navStack.forEach((lvl,i)=>{
    const span = document.createElement('span');
    span.textContent = lvl.title;
    if(i === navStack.length-1) span.className = 'current';
    else span.addEventListener('click', ()=>{ navStack = navStack.slice(0,i+1); renderCurrentLevel(); });
    box.appendChild(span);
    if(i < navStack.length-1){
      const sep = document.createElement('span');
      sep.className = 'sep'; sep.textContent = '›';
      box.appendChild(sep);
    }
  });
}

/* ============================================================
   RESULTS GRID — natively scrollable, holds every item at once.
   ============================================================ */
function showScreen(which){
  document.getElementById('favWrap').style.display = which==='home' ? 'flex' : 'none';
  document.getElementById('homeGrid').style.display = which==='home' ? 'grid' : 'none';
  document.getElementById('resultsWrap').style.display = which==='results' ? 'flex' : 'none';
  document.getElementById('searchWrap').style.display = which==='search' ? 'flex' : 'none';
  document.getElementById('backBtn').classList.toggle('show', which!=='home');
  document.getElementById('appTitle').classList.toggle('hide', which!=='home');
  if(which==='home'){
    // Home never shows a breadcrumb trail from a previous drill-down.
    const box = document.getElementById('breadcrumbBox');
    box.style.display = 'none';
    box.innerHTML = '';
  }
}

function renderResultsGrid(){
  const level = currentLevel();
  const grid = document.getElementById('resultsGrid');
  document.getElementById('resultsScroll').scrollTop = 0;
  if(!level){ grid.innerHTML=''; return; }
  grid.innerHTML = '';
  if(level.items.length === 0){
    const msg = document.createElement('div');
    msg.className = 'fav-empty';
    msg.style.gridColumn = '1 / -1';
    msg.textContent = t('noResults');
    grid.appendChild(msg);
    return;
  }
  level.items.forEach(item=>{
    grid.appendChild(item.kind === 'category' ? buildCategoryTile(item) : buildStationTile(item.station));
  });
}

function buildCategoryTile(item){
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.innerHTML = `<div class="icon"><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" class="di-fill"/><circle cx="6" cy="18" r="3" class="di-dot"/><circle cx="18" cy="16" r="3" class="di-dot"/></svg></div><div class="label">${escapeHtml(item.title)}</div>`;
  tile.addEventListener('click', ()=> item.onOpen());
  return tile;
}

function buildStationTile(station){
  const tile = document.createElement('div');
  tile.className = 'stile';
  tile.innerHTML = `
    <img src="${stationLogo(station)}" loading="lazy" onerror="this.src='${placeholderLogo(station.name, station.uuid)}'">
    <div class="sinfo">
      <div class="sname">${escapeHtml(station.name)}</div>
      <div class="stags">${escapeHtml([station.country, station.tags].filter(Boolean).join(' · '))}</div>
    </div>`;
  tile.addEventListener('click', ()=> play(station));
  return tile;
}

/* ============================================================
   BACK NAVIGATION + HOME
   ============================================================ */
document.getElementById('backBtn').addEventListener('click', ()=>{
  if(document.getElementById('searchWrap').style.display === 'flex'){ goHome(); return; }
  if(navStack.length > 1){ navStack.pop(); renderCurrentLevel(); }
  else goHome();
});
function goHome(){
  navStack = [];
  showScreen('home');
}

/* ============================================================
   SEARCH SCREEN
   ============================================================ */
function openSearch(){
  navStack = [];
  showScreen('search');
  document.getElementById('backBtn').classList.add('show');
  document.getElementById('searchInput').value = '';
  searchResults = [];
  renderSearchGrid();
  setTimeout(()=> document.getElementById('searchInput').focus(), 50);
}

document.getElementById('searchInput').addEventListener('input', (e)=>{
  const q = e.target.value.trim();
  clearTimeout(searchDebounce);
  if(!q){ searchResults = []; renderSearchGrid(); return; }
  searchDebounce = setTimeout(async ()=>{
    try{
      searchResults = await withLoading(searchStations({ name:q, limit:100 }));
    }catch(err){
      searchResults = [];
    }
    renderSearchGrid();
  }, 350);
});

function renderSearchGrid(){
  const grid = document.getElementById('searchGrid');
  grid.innerHTML = '';
  const q = document.getElementById('searchInput').value.trim();
  if(q && searchResults.length === 0){
    const msg = document.createElement('div');
    msg.className = 'fav-empty';
    msg.style.gridColumn = '1 / -1';
    msg.textContent = t('noResults');
    grid.appendChild(msg);
  } else {
    searchResults.forEach(s => grid.appendChild(buildStationTile(s)));
  }
}

/* ============================================================
   SETTINGS PANEL
   ============================================================ */
const overlay = document.getElementById('settingsOverlay');
document.getElementById('settingsBtn').addEventListener('click', ()=> overlay.classList.add('show'));
document.getElementById('closeSettings').addEventListener('click', ()=> overlay.classList.remove('show'));

// ---- Theme: system by default (follows prefers-color-scheme), optional override ----
function applyTheme(){
  const override = localStorage.getItem('autoradio_theme'); // 'light' | 'dark' | null (=system)
  if(override) document.documentElement.setAttribute('data-theme', override);
  else document.documentElement.removeAttribute('data-theme');
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{
  if(!localStorage.getItem('autoradio_theme')) applyTheme();
});

// ---- Accent color ----
function applyAccent(){
  const accent = localStorage.getItem('autoradio_accent') || 'green';
  if(accent === 'green') document.documentElement.removeAttribute('data-accent');
  else document.documentElement.setAttribute('data-accent', accent);
}
applyAccent();

// ---- Font size ----
function applyFontSize(){
  const size = localStorage.getItem('autoradio_fontsize') || 'medium';
  if(size === 'medium') document.documentElement.removeAttribute('data-fontsize');
  else document.documentElement.setAttribute('data-fontsize', size);
}
applyFontSize();

/* Data source: "auto" races all known mirrors and picks the fastest;
   "eu" pins to the European mirrors only (skips the discovery race,
   useful if the auto-race itself is adding latency). There is
   currently no non-European Radio-Browser mirror to offer here —
   see the note in the settings panel. */
function applySource(){
  const source = localStorage.getItem('autoradio_source') || 'auto';
  setPreferEuServersOnly(source === 'eu');
}
applySource();

function wireSegGroup(id, storageKey, defaultValue, onChange, btnSelector='.seg-btn'){
  const group = document.getElementById(id);
  const current = localStorage.getItem(storageKey) || defaultValue;
  group.querySelectorAll(btnSelector).forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.value === current);
    btn.addEventListener('click', ()=>{
      localStorage.setItem(storageKey, btn.dataset.value);
      group.querySelectorAll(btnSelector).forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      if(onChange) onChange(btn.dataset.value);
    });
  });
}

wireSegGroup('themeSeg', 'autoradio_theme', 'system', (val)=>{
  if(val === 'system') localStorage.removeItem('autoradio_theme');
  applyTheme();
});
// theme default needs special handling since 'system' means "no key stored"
(function initThemeSeg(){
  const stored = localStorage.getItem('autoradio_theme');
  document.querySelectorAll('#themeSeg .seg-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.value === (stored || 'system'));
  });
})();

wireSegGroup('accentSeg', 'autoradio_accent', 'green', applyAccent, '.swatch');
wireSegGroup('fontSizeSeg', 'autoradio_fontsize', 'medium', applyFontSize);
wireSegGroup('sourceSeg', 'autoradio_source', 'auto', applySource);
wireSegGroup('chinaProxySeg', 'autoradio_china_proxy', 'off');
wireSegGroup('langSeg', 'autoradio_lang', currentLang, (val)=> setLang(val));

// stream-proxy credentials (China fallback) — localStorage-only, never in source.
document.getElementById('proxyUser').value = localStorage.getItem('autoradio_proxy_user') || '';
document.getElementById('proxyPass').value = localStorage.getItem('autoradio_proxy_pass') || '';
document.getElementById('proxySaveBtn').addEventListener('click', ()=>{
  localStorage.setItem('autoradio_proxy_user', document.getElementById('proxyUser').value.trim());
  localStorage.setItem('autoradio_proxy_pass', document.getElementById('proxyPass').value);
});
document.getElementById('proxyTestBtn').addEventListener('click', async ()=>{
  // Save first so the test uses whatever is currently typed in.
  localStorage.setItem('autoradio_proxy_user', document.getElementById('proxyUser').value.trim());
  localStorage.setItem('autoradio_proxy_pass', document.getElementById('proxyPass').value);
  const status = document.getElementById('proxyStatus');
  status.style.display = 'block';
  status.textContent = t('testing');
  try{
    // fetch() (unlike <audio src>) refuses URLs with embedded credentials,
    // so the test sends Basic Auth as a real header instead of userinfo.
    const testUrl = NOW_PLAYING_WORKER_URL + '/stream?url=' + encodeURIComponent(PROXY_TEST_STREAM_URL);
    const auth = 'Basic ' + btoa(`${localStorage.getItem('autoradio_proxy_user')||''}:${localStorage.getItem('autoradio_proxy_pass')||''}`);
    const res = await fetch(testUrl, { headers: { Range: 'bytes=0-0', Authorization: auth } });
    if(res.status === 401) status.innerHTML = `<span class="diag-fail">✗ ${t('proxyAuthFailed')}</span>`;
    else if(res.status === 403) status.innerHTML = `<span class="diag-fail">✗ ${t('proxyOriginBlocked')}</span>`;
    else if(res.status === 429) status.innerHTML = `<span class="diag-fail">✗ ${t('proxyRateLimited')}</span>`;
    else if(res.ok) status.innerHTML = `<span class="diag-ok">✓ ${t('connectionOk')}</span>`;
    else status.innerHTML = `<span class="diag-fail">✗ HTTP ${res.status}</span>`;
  }catch(e){
    // A CORS-origin mismatch throws here as a generic network-style error
    // rather than a readable 403 — the browser hides the real response from
    // JS for cross-origin failures, so this is the only place that case is
    // visible, and it's the overwhelmingly likely cause when testing from
    // anywhere other than the deployed app's own origin.
    status.innerHTML = `<span class="diag-fail">✗ ${escapeHtml(e.message)} — ${t('proxyOriginBlocked')}</span>`;
  }
});

function onLangChanged(){
  renderFavs();
  if(document.getElementById('resultsWrap').style.display === 'flex'){ renderBreadcrumb(); renderResultsGrid(); }
  if(document.getElementById('searchWrap').style.display === 'flex') renderSearchGrid();
}

document.getElementById('addStreamBtn').addEventListener('click', ()=>{
  const name = document.getElementById('addName').value.trim();
  const url = document.getElementById('addUrl').value.trim();
  if(!name || !url) return;
  const custom = { uuid: 'custom-' + Date.now(), name, url, favicon:'', tags:'', country:'', countryCode:'' };
  favorites.push(custom);
  saveJSON(STORAGE_KEYS.favorites, favorites);
  renderFavs();
  document.getElementById('addName').value = '';
  document.getElementById('addUrl').value = '';
  overlay.classList.remove('show');
});

/* ---------- clear all favorites, with confirm/cancel ---------- */
const clearConfirmBox = document.getElementById('clearConfirmBox');
document.getElementById('clearFavsBtn').addEventListener('click', ()=>{
  clearConfirmBox.style.display = 'flex';
});
document.getElementById('clearFavsCancel').addEventListener('click', ()=>{
  clearConfirmBox.style.display = 'none';
});
document.getElementById('clearFavsConfirm').addEventListener('click', ()=>{
  clearAllFavorites();
  clearConfirmBox.style.display = 'none';
});

/* ---------- now-playing on-device diagnostics ---------- */
document.getElementById('npDiagnosticsBtn').addEventListener('click', async ()=>{
  const box = document.getElementById('npDiagnosticsResult');
  const btn = document.getElementById('npDiagnosticsBtn');
  // Diagnostics text is hardcoded DE/EN (not routed through I18N/t()) —
  // it's a developer-facing debug log, not core UI copy.
  const isEn = currentLang === 'en';
  const testUrl = (currentStation && currentStation.url) || (favorites[0] && favorites[0].url);
  if(!testUrl){
    box.style.display = 'block';
    box.textContent = isEn
      ? 'No station selected and no favorites available — play a station first, then test.'
      : 'Kein Sender ausgewählt und keine Favoriten vorhanden — erst einen Sender abspielen, dann testen.';
    return;
  }
  btn.disabled = true;
  box.style.display = 'block';
  const prompt = (isEn ? 'Testing against: ' : 'Teste gegen: ') + testUrl;
  box.textContent = prompt + ' …';
  try{
    const results = await runNowPlayingDiagnostics(testUrl);
    // results[0] is only the "is a worker URL configured?" sanity check,
    // not an actual delivery attempt — skip it when picking the overall
    // pass/fail so a config check doesn't get reported as "it worked".
    const tiers = results.slice(1);
    const success = tiers.find(r => r.ok);
    if(success){
      box.innerHTML = `${escapeHtml(prompt)} — <span class="diag-ok">✓ ${isEn ? 'OK' : 'OK'} (${escapeHtml(success.tier)})</span>`;
    } else {
      const last = tiers[tiers.length - 1];
      const reason = (last && last.detail || '').slice(0, 80);
      box.innerHTML = `${escapeHtml(prompt)} — <span class="diag-fail">✗ ${isEn ? 'Failed' : 'Fehlgeschlagen'}: ${escapeHtml(reason)}</span>`;
    }
  }catch(e){
    box.textContent = (isEn ? 'Diagnostics failed: ' : 'Diagnose fehlgeschlagen: ') + e.message;
  }
  btn.disabled = false;
});

/* ============================================================
   UTIL
   ============================================================ */
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* ============================================================
   VIEWPORT HEIGHT FIX — embedded in-car browsers (ONVO, Tesla, etc.)
   often have dynamic chrome (address bar, tab strip) that changes the
   real visible height without CSS's 100vh reflecting it reliably,
   which is the most likely cause of the player being cut off at the
   bottom. We measure the actual visible height in JS and expose it
   as --vh, kept in sync on resize/orientation change.
   ============================================================ */
function setViewportHeightVar(){
  document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
}
setViewportHeightVar();
window.addEventListener('resize', setViewportHeightVar);
window.addEventListener('orientationchange', setViewportHeightVar);

/* ============================================================
   ON-SCREEN KEYBOARD INSET — window.innerHeight above mostly does NOT
   change when the on-screen keyboard opens (only the visual viewport
   shrinks), so the keyboard used to sit as a plain overlay on top of
   the fixed-height layout and bury the bottom search results until
   dismissed by hand. The VisualViewport API is the one that actually
   reports the keyboard opening; we expose its height as --kb-inset so
   the search screen (see #searchWrap in style.css) can compress itself
   into exactly the space that's still visible above the keyboard.
   ============================================================ */
function updateKeyboardInset(){
  if(!window.visualViewport) return;
  const inset = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
  document.documentElement.style.setProperty('--kb-inset', inset + 'px');
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', updateKeyboardInset);
  window.visualViewport.addEventListener('scroll', updateKeyboardInset);
  updateKeyboardInset();
}

/* ============================================================
   INIT
   ============================================================ */
applyI18n();
document.getElementById('appVersionLabel').textContent = 'v' + APP_VERSION;
document.getElementById('appVersionLabelBack').textContent = 'v' + APP_VERSION;
document.getElementById('aboutVersion').textContent = 'v' + APP_VERSION;
setLang(currentLang);
renderFavs();

/* Seed a well-known German station as a starter favorite on first
   run only, so the app isn't empty before the user has picked
   anything (harmless if it fails offline). */
if(favorites.length === 0 && !localStorage.getItem('autoradio_seeded')){
  localStorage.setItem('autoradio_seeded', '1');
  searchStations({ name:'Deutschlandfunk', limit:1 }).then(res=>{
    if(res[0]){ favorites.push(res[0]); saveJSON(STORAGE_KEYS.favorites, favorites); renderFavs(); }
  }).catch(()=>{});
}
