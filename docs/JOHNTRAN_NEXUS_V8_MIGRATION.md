# JOHNTRAN NEXUS V8 — Repository Migration

> Migration target, not a claim that the repository has already been moved. The branch is the isolated workspace for the physical migration.

## Migration contract

- Preserve the current CommonJS runtime, Node >=20.18, panel/single-bot startup, command names, aliases, command config contracts, event hooks, data schemas and environment variable names.
- Keep `index.js` and `JohnTran.js` as stable compatibility entrypoints until the new bootstrap is proven equivalent.
- Do not relocate `vendor/`, generated/runtime state, user data, secrets, deployment descriptors or binary assets blindly.
- Move source modules with their dependency paths updated in the same commit; retain compatibility facades for old import paths until repository-wide reference checks pass.
- No destructive delete of old paths before tests and deployment smoke checks pass.

## Target architecture

```text
JOHNTRAN-JS/
├── index.js                         # stable supervisor entry
├── JohnTran.js                      # stable legacy bot entry (temporary facade)
├── app/
│   ├── bootstrap/                   # startup, lifecycle, health
│   ├── runtime/
│   │   ├── gateway/                 # Zalo listener + event ingress
│   │   ├── pipeline/                # parsing, middleware, dispatch
│   │   ├── registry/                # command/event registries
│   │   └── compatibility/           # legacy contract adapters
│   ├── domains/
│   │   ├── users/
│   │   ├── groups/
│   │   ├── games/
│   │   │   ├── cultivation/
│   │   │   ├── pvp/
│   │   │   ├── economy/
│   │   │   └── leaderboard/
│   │   ├── music/
│   │   ├── stickers/
│   │   ├── media/
│   │   └── social/
│   ├── infrastructure/
│   │   ├── adapters/                # Zalo, database, HTTP
│   │   ├── persistence/             # JSON/Supabase adapters
│   │   ├── cache/
│   │   ├── queue/
│   │   ├── workers/
│   │   ├── observability/           # logger, metrics, health
│   │   └── config/
│   └── shared/                      # errors, constants, helpers
├── interfaces/
│   ├── commands/                    # existing plugin contracts
│   ├── events/
│   └── panel/                       # panel API + bot manager
├── resources/
│   ├── assets/
│   ├── frames/
│   └── templates/
├── storage/                         # runtime-created data only; preserve old paths via config
├── config/                          # static configuration templates
├── scripts/
├── tests/
├── docs/
├── native/                          # Rust/native source
├── vendor/                          # vendored dependency; do not rewrite
└── deploy/                          # Docker/Render/Koyeb deployment assets
```

## Current path migration map

| Current path | NEXUS V8 destination | Migration notes |
|---|---|---|
| `core/bootstrap.js`, `core/login.js`, `core/listen.js`, `core/health.js` | `app/bootstrap/` + `app/runtime/gateway/` | Keep lifecycle ordering and health-before-login behavior |
| `core/handle/`, `core/runtime/`, `core/loader/` | `app/runtime/pipeline/`, `app/runtime/registry/` | Compatibility facades preserve old require paths |
| `core/controller/`, `core/runtime/services/` | `app/domains/users/`, `groups/`, `games/` | Preserve storage schema and service contracts |
| `core/games/` | `app/domains/games/cultivation/` + `pvp/` | Tu Tiên engine remains source of game rules |
| `core/music/` | `app/domains/music/` | Preserve provider names and /scl behavior |
| `core/sticker*.js`, `core/canvas/`, `core/pixelfx/` | `app/domains/stickers/` + `resources/frames/` | Preserve frame IDs, output format and commands |
| `core/media*.js`, `core/http/`, `core/workers/`, `core/workerPool.js`, `core/jobQueue.js` | `app/domains/media/` + `app/infrastructure/queue/` + `workers/` | Bounded queue and worker concurrency remain unchanged |
| `core/storage/`, `utils/db.js`, `utils/batchDb.js` | `app/infrastructure/persistence/` | Preserve JSON/Supabase selection and all data keys |
| `core/cache*` | `app/infrastructure/cache/` | Preserve public cache API and TTL behavior |
| `utils/` | `app/shared/` or relevant infrastructure module | Split by responsibility, not a blind folder rename |
| `plugins/commands/`, `plugins/events/` | `interfaces/commands/`, `interfaces/events/` | Keep plugin file names and command metadata |
| `panel/` | `interfaces/panel/` | Preserve panel endpoints and bot manager behavior |
| `assets/`, `khung-stk/` | `resources/assets/`, `resources/frames/` | Update path consumers; retain original binary content |
| `test/` | `tests/` | Update test discovery and CI in the same migration |
| `src/` | `app/shared/typescript-compat/` or remove only after build audit | Existing TS entry is a second, currently separate bootstrap; do not silently switch production to it |
| `native/`, `deploy/`, `supabase/`, `vendor/` | retained at root initially | Toolchain/deployment/data ownership boundaries; move only with dedicated verification |

## Execution phases

1. **Inventory + path graph:** enumerate all tracked paths, imports, dynamic requires, fs paths, Docker/Render/Nodemon/TypeScript references and test discovery.
2. **Foundation move:** relocate runtime/bootstrap modules with compatibility facades; verify both entrypoints and panel mode.
3. **Domain moves:** migrate games, users/groups, music, stickers, media one bounded domain at a time.
4. **Interfaces + resources:** migrate plugins, panel, assets and frame files; update all path consumers.
5. **Utilities + tests:** consolidate shared helpers, update CI and test locations.
6. **Cutover:** remove compatibility facades only after import scan, full tests, command smoke tests, panel smoke test and deployment validation pass.

## Required verification

- `npm test`
- `node scripts/test-commands.js`
- `node scripts/test-all.js`
- `npm run build`
- Search for stale imports and old asset/data paths.
- Verify `npm start`, `npm run dev`, panel mode, single-bot mode, /stk, /scl, event plugins and Tu Tiên/PvP.
