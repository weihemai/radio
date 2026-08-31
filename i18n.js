const I18N = {
  de: {
    back:"Zurück", hereLocal:"Hier vor Ort", favorites:"Favoriten",
    language:"Sprache", allStations:"Alle Sender",
    country:"Land", recent:"Zuletzt gehört", search:"Suche",
    searchPlaceholder:"Sender suchen…", swipeHint:"↕ nach oben/unten wischen für mehr Sender",
    loading:"Lädt…", pickStation:"Sender wählen", ready:"Bereit", playing:"Spielt jetzt",
    paused:"Pausiert", unreachable:"Stream nicht erreichbar", close:"Schließen ✕",
    settings:"Einstellungen", language2:"Sprache",
    theme:"Darstellung", themeSystem:"System", themeLight:"Hell", themeDark:"Dunkel",
    accentColor:"Akzentfarbe",
    addStream:"Stream manuell hinzufügen", stationName:"Sendername", addBtn:"Hinzufügen",
    noResults:"Keine Treffer.", noFavorites:"Noch keine Favoriten — Stern im Player antippen.",
    page:"Seite", of:"/", loadError:"Sender konnten nicht geladen werden. Bitte Verbindung prüfen.",
    allCountries:"Alle Länder", allLanguages:"Alle Sprachen",
    fontSize:"Schriftgröße", fontSmall:"Klein", fontMedium:"Mittel", fontLarge:"Groß",
    clearFavs:"Alle Favoriten löschen", clearFavsConfirmMsg:"Wirklich alle Favoriten löschen?",
    cancel:"Abbrechen", confirmDelete:"Löschen",
    dataSource:"Datenquelle", sourceAuto:"Automatisch", sourceEu:"EU-Server",
    sourceNote:"Basiert auf der offenen Radio-Browser-Datenbank (aktuell die einzige community-gepflegte, wirklich offene Quelle; es gibt keine Server in Asien).",
    npDiagnostics:"Now-Playing Diagnose", npDiagnosticsRun:"Test ausführen"
  },
  en: {
    back:"Back", hereLocal:"Local time here", favorites:"Favorites",
    language:"Language", allStations:"All Stations",
    country:"Country", recent:"Recently Played", search:"Search",
    searchPlaceholder:"Search station…", swipeHint:"↕ swipe up/down for more stations",
    loading:"Loading…", pickStation:"Choose a station", ready:"Ready", playing:"Now playing",
    paused:"Paused", unreachable:"Stream unavailable", close:"Close ✕",
    settings:"Settings", language2:"Language",
    theme:"Appearance", themeSystem:"System", themeLight:"Light", themeDark:"Dark",
    accentColor:"Accent color",
    addStream:"Add stream manually", stationName:"Station name", addBtn:"Add",
    noResults:"No results.", noFavorites:"No favorites yet — tap the star in the player.",
    page:"Page", of:"of", loadError:"Could not load stations. Please check your connection.",
    allCountries:"All Countries", allLanguages:"All Languages",
    fontSize:"Font size", fontSmall:"Small", fontMedium:"Medium", fontLarge:"Large",
    clearFavs:"Clear all favorites", clearFavsConfirmMsg:"Really delete all favorites?",
    cancel:"Cancel", confirmDelete:"Delete",
    dataSource:"Data source", sourceAuto:"Automatic", sourceEu:"EU servers",
    sourceNote:"Powered by the open Radio-Browser database (currently the only community-run, truly open source; no servers exist in Asia).",
    npDiagnostics:"Now-Playing diagnostics", npDiagnosticsRun:"Run test"
  }
};

let currentLang = localStorage.getItem('autoradio_lang') || 'de';

function t(key){
  return (I18N[currentLang] && I18N[currentLang][key]) || key;
}

function applyI18n(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.documentElement.lang = currentLang;
}

function setLang(lang){
  currentLang = lang;
  localStorage.setItem('autoradio_lang', lang);
  applyI18n();
  document.querySelectorAll('#langSeg .seg-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.value === lang);
  });
  if(typeof onLangChanged === 'function') onLangChanged();
}
