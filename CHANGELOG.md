# Changelog

All notable changes to Autoradio are documented here, newest first.
Versions correspond to the `APP_VERSION` constant in `app.js`.

## [1.7.1] - 2026-09-07

- Added a "PROXY" badge next to the station name in the player, shown
  whenever the current station is playing through the China fallback.
- Added a "Test connection" button next to the proxy credentials fields.
- Fixed the connection test itself: `fetch()` (unlike `<audio src>`)
  refuses URLs with embedded credentials, so it now sends Basic Auth as a
  real `Authorization` header — which also required adding `Authorization`
  to the `nowplaying` service's CORS allow-list for the `/stream` route.

## [1.7.0] - 2026-09-07

- Added an opt-in fallback for radio streams blocked by China's Great
  Firewall: on playback timeout/error, the app retries once through the
  now-playing service's new `/stream` route before showing the normal
  failure message. Off by default — enable in Settings ("China-Zugriff").
- Added a dedicated username/password field in Settings for the proxy's
  HTTP Basic Auth, stored only in `localStorage`, never in source.
- Now-playing service (`nowplaying` repo): new `/stream?url=` route pipes
  audio through (Range/seek support, no timeout on the pipe itself),
  protected by Basic Auth, an origin allowlist, and a per-IP rate limit.

## [1.6.0] - 2026-09-06

- Accent-colored app icon next to "Autoradio" in the topbar and the
  settings dialog's title bar.
- Fixed the clock drifting off-center between screens (topbar is now a
  3-column grid instead of flex `space-between`).
- Added "connecting to server / connected, loading data" status messaging
  for station search and browsing.
- Compressed the home navigation into a single row of 5 tiles, icon and
  label side by side with a larger label.
- Removed the "Hier vor Ort"/"Local time here" clock sub-label.
- Fixed the language default to English (theme/accent/font/source
  defaults already matched: system/green/medium/automatic).
- Data source row: removed the explanatory note, moved the diagnostics
  test button inline, and compacted the diagnostics log to a single line
  with hardcoded German/English text.

## [1.5.0] - 2026-09-01

- Fixed squeezed/cropped favorite tile cover art.

## [1.4.0] - 2026-08-23

- Aligned the UI with Autopod: settings dialog redesign, favorites grid,
  keyboard-safe search screen.
- Added the app favicon.

## [1.3.0] - 2026-08-21

- Now-playing (ICY metadata) integration, initially via a Cloudflare
  Worker, ported to a small Render.com Node service (see the `nowplaying`
  repo) once free-tier limits made that a better fit.

## Earlier builds - 2026-08-19 – 2026-08-21

Initial build-out, before version numbers were tracked: station search via
radio-browser.info, favorites, the player bar, dark/light mode, and the
first settings dialog.
