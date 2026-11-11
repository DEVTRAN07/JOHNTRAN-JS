# CHANGELOG

## [4.0.0] — 2026-11-11

### Security
- Removed the committed default Panel credential; public binds now fail closed unless `JT_PANEL__TOKEN` is configured with at least 32 characters.
- Panel API, QR and Prometheus metrics require `Authorization: Bearer`; query-string token authentication is removed.
- Dashboard tokens are session-scoped in the browser; the internal bot bridge now uses a separate `JT_BRIDGE_TOKEN`.
- Replaced wildcard CORS with an explicit `panel.allowed_origins` allowlist.

### Runtime & cache
- Aligned `npm start`, `npm run dev`, `start:prod` and package entry point with the supervisor `index.js`.
- Aligned Render and CI with Node 22; added the Node engine requirement.
- Local media-cache reads validate size, checksum and content-derived key; writes publish via temporary files and rename.
- Corrected `MEDIA_CACHE_TTL_*` handling to interpret documented environment values as seconds.

### Tests
- Added focused test coverage for Panel token validation and media-cache corruption/expiry.
- Added `npm test` to the GitHub Actions test job.

## [1.2.0] — 2026-11-08

### Added
- DNS-over-HTTPS fallback in `core/http` + `core/http/dns.js` — bypasses system DNS failures (NXDOMAIN) by connecting to DoH resolvers via hardcoded IPs (Cloudflare 1.1.1.1/1.0.0.1, Google 8.8.8.8/8.8.4.4). Affects all outbound requests.
- `render.yaml` — Render.com blueprint (web service, Node 20, 1GB disk).
- `.github/workflows/ci.yml` — GitHub Actions CI: runs `npm install` + `test-commands` + `test-all` on push/PR to main/master.

### Changed
- `/vdgirl` now uses `core/http.getBuffer()` (was raw axios) — respects privacy allowlist + DoH fallback.
- `/lyric` now uses LRCLIB (`lrclib.net`) directly for lyrics; fixed provider name `soundcloud` → `scl`.
- `/stk` preview failure is now NON-FATAL — if ffmpeg cannot extract a preview frame from animated WebP, the sticker is still uploaded and sent (warning logged instead of aborting).
- `core/http/dns.js` rewritten cleanly with Vietnamese comments and bootstrap-by-IP strategy.

### Fixed
- `core/http/index.js` `isDnsError()`: bare identifiers `ENOTFOUND`/`ECONNREFUSED`/`ENAMETOOLONG` were unquoted (would throw ReferenceError on DNS failure) — now string literals.
- `catbox.moe`, `lrclib.net`, `cloudflare-dns.com`, `dns.google` added to `DEFAULTS.privacy.allowed_hosts` (in addition to `config.yml`).

### Removed
- `/phatnguoi` (kiểm tra phạt nguội) command — file deleted, all references removed from config, defaults, tests.
