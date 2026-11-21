# JOHNTRAN gradual Rust migration

## Runtime boundary

JOHNTRAN remains a Node.js application during the staged migration. Zalo login,
the Zalo-Client SDK, WebSocket listener, plugin contract, panel and network
requests stay in JavaScript until a replacement is proven compatible.

Rust modules are exposed through small N-API facades. Each migrated operation
must have a JavaScript fallback so a deployment without Rust or a prebuilt
native binary can still run.

## Stage 1 — command-token parser

- Rust crate: `native/command-core-rs`.
- Runtime bridge: `native/index.js`.
- Integration: `core/handle/handleCommand.js`.
- Scope: match prefix, lowercase command name, split arguments using the
  existing whitespace-based contract.
- Rollback: set `JT_RUST_COMMAND_PARSER=0` to force the JavaScript parser.
- Verification: Cargo unit tests, Node parity tests and a CI N-API smoke test.

This small parsing operation is a safe first migration seam. It is not expected
to materially change end-to-end reply latency.

## Stage 2 — Caro domain engine

- Rust crate: `native/game-core-rs`.
- Runtime bridge: `native/index.js`.
- Compatibility facade: `src/domain/games/engines/caroEngine.js`.
- Scope: winning-line evaluation, move evaluation and AI move selection for the
  existing 16×16 Caro rules. The JavaScript facade still owns and mutates the
  session board so existing command/service APIs remain unchanged.
- Rollback: set `JT_RUST_CARO_ENGINE=0` to force the JavaScript implementation.
- Verification: Rust unit tests, JavaScript native/fallback parity fixtures and
  a CI N-API smoke test.

This is an architectural migration of deterministic domain logic. The Caro
board workload is small, so it is not presented as a guaranteed end-to-end
latency improvement.

## Stage 3 — Nối Từ text engine

- Rust crate: `native/game-core-rs` (Unicode normalization dependency).
- Runtime bridge: `native/index.js`.
- Compatibility facade: `src/domain/games/engines/noituEngine.js`.
- Scope: Vietnamese syllable normalization, phrase normalization and phrase
  parsing. The JavaScript layer continues to own session state, player order,
  duplicate history and turn transitions.
- Rollback: set `JT_RUST_NOITU_ENGINE=0` to force the JavaScript functions.
- Verification: Unicode edge-case fixtures, JS/Rust parity tests and a CI
  N-API smoke test.

## Stage 4 — Sâm card-rule engine

- Rust crate: `native/game-core-rs`.
- Runtime bridge: `native/index.js`.
- Compatibility facade: `src/domain/games/engines/samEngine.js`.
- Scope: deck creation/sorting, Vietnamese text cleanup, card parsing, combo
  analysis, beating rules, play validation, card removal, white-hand detection,
  white-hand comparison and card formatting.
- Shuffle/deal keeps the existing JavaScript random callback so seeded tests and
  the current service contract retain their exact random-call order.
- Rollback: set `JT_RUST_SAM_ENGINE=0` to force the JavaScript implementation.
- Verification: Rust unit tests, N-API smoke tests and full JS/Rust fixture parity.

## Stage 5 — Tiến Lên Miền Nam rules engine

- Rust crate: `native/game-core-rs`, reusing the card/combo N-API data
  structures introduced for Sâm.
- Runtime bridge: `native/index.js`.
- Compatibility facade: `src/domain/games/engines/tlmnEngine.js`.
- Scope: deck/card metadata, card parsing and sorting, rank parsing, combo
  analysis, pair-run/chop rules, play validation, removal, white-hand detection
  and comparison, and card formatting.
- Shuffle/deal continue to use the existing JavaScript random callback so the
  exact seeded random-call order and room state contracts remain unchanged.
- Command grammar parsing and room/service state remain in JavaScript for now.
- Rollback: set `JT_RUST_TLMN_ENGINE=0` to force the JavaScript implementation.
- Verification: Rust unit tests, N-API smoke test, full JavaScript/native
  parity fixtures, and the existing TLMN service/command integration suite.

## Stage 6 — group bot state policy

- Rust crate: `native/domain-core-rs`.
- Runtime bridge: `native/index.js`.
- Compatibility facade: `src/domain/groups/botState.js`.
- Scope: strict boolean group-enabled policy, `/bot on` and `/bot status`
  exceptions, prefixed control-message parsing, group-state flag mapping and
  ordered snapshots. Zalo group records and object merging remain in JavaScript.
- Rollback: set `JT_RUST_GROUP_STATE=0` to force the JavaScript implementation.
- Verification: Rust unit tests, JavaScript/Rust parity fixtures and CI
  N-API smoke test.

## Stage 7 — requester identity and greeting policy

- Rust crate: `native/domain-core-rs`.
- Runtime bridge: `native/index.js`.
- Compatibility facade: `src/domain/users/requesterGreeting.js` (legacy
  import remains available at `core/runtime/requesterGreeting.js`).
- Scope: UID string normalization, ordered/deduplicated admin IDs, explicit
  owner resolution, admin/support membership and owner > admin > support >
  member role priority. The existing Vietnamese greeting and prompt strings
  remain in the JavaScript adapter.
- JavaScript retains String() coercion and truthy owner-field selection before
  calling N-API so legacy config values preserve their behaviour.
- Rollback: set `JT_RUST_REQUESTER_GREETING=0`.
- Verification: Rust unit tests, full JavaScript/Rust parity fixtures and a
  CI N-API smoke test.

## Stage 8 — Anti-protection settings policy

- Rust crate: `native/domain-core-rs`.
- Runtime bridge: `native/index.js`.
- Compatibility facade: `src/domain/moderation/protectionState.js` (legacy
  import remains available at `core/runtime/antiProtection.js`).
- Scope: the ordered 21-key Anti registry, feature-key validation and strict
  boolean state mapping. JavaScript retains the existing error messages,
  input-type checks and in-place update of the caller's group data object.
- Rollback: set `JT_RUST_ANTI_PROTECTION=0`.
- Verification: Rust unit tests, JavaScript/Rust parity fixtures and CI
  N-API smoke test.

## Stage 9 — command role and group permission policy

- Rust crate: `native/domain-core-rs`.
- Runtime bridge: `native/index.js`.
- Compatibility facade: `core/runtime/middleware/permissions.js`.
- Scope: role-level admin/support denial, ordered group restrictions
  (admin-only > support-only > group-admin-only), and three-state group-admin
  resolution. JavaScript retains the existing Zalo group-info lookup, cache,
  async Promise boundary, and command-pipeline response objects.
- The adapter preserves strict `isGroup === false`, the existing truthiness
  checks, and the legacy loose creator-ID comparison before passing primitive
  policy inputs to Rust.
- Rollback: set `JT_RUST_PERMISSION_POLICY=0`.
- Verification: Rust unit tests, JS/Rust decision parity, synchronous fast-path
  and asynchronous live-admin-check tests, and CI N-API smoke test.

## Stage 10 — restart backoff policy

- Rust crate: `native/domain-core-rs`.
- Runtime bridge: `native/index.js`.
- Compatibility facade: `core/runtime/restartPolicy.js`.
- Scope: rolling-window timestamp filtering, attempt counting, cooldown
  calculation and capped exponential delay. The JS supervisor continues to own
  process restart, timers and shutdown lifecycle.
- Rollback: set `JT_RUST_RESTART_POLICY=0`.
- Verification: Rust unit tests, JavaScript/Rust plan parity fixtures and CI
  N-API smoke test.

## Stage 12 — shared HTTP request policy

- Rust crate: `native/domain-core-rs`.
- Runtime bridge: `native/index.js`.
- Compatibility facade: `core/http/requestPolicy.js`.
- Scope: bounded integer clamping and the combined timeout/retry/delay policy
  calculation. JavaScript retains env/config property reads and `Number()`
  coercion order; HTTP transport, DNS, privacy checks, retries, waits and Zalo
  network operations remain in Node.
- Rollback: set `JT_RUST_HTTP_REQUEST_POLICY=0`.
- Verification: Rust unit tests, JS/Rust parity for config/env edge values,
  property-getter and `valueOf()` evaluation order, and CI N-API smoke test.

## Later migration order

1. Continue auditing remaining pure command-validation and parsing helpers;
   leave all network calls and process/timer orchestration in JS.
2. Media/image work: expand the existing Rust sticker path. Only activate
   canvas/FFmpeg Rust prototypes after platform builds, output parity and
   realistic performance tests pass.
3. Stateful hot paths: consider cache, deduplication and queue internals only
   when profiling shows measurable JavaScript CPU or event-loop pressure.
4. Zalo protocol/session: keep the current SDK in Node unless a Rust replacement
   proves login, reconnect, event-ordering, rate-limit and send behaviour parity.

## Build and rollback

Install a Rust stable toolchain on the target machine, then run:

```bash
npm run build:native
npm test
```

Disable the Rust command parser without removing the addon:

```bash
JT_RUST_COMMAND_PARSER=0 npm start
```

Build native binaries on the deployment architecture. For example, build on
Termux/Android for that target rather than copying a macOS or Linux binary.

## Acceptance criteria for each module

- Existing command names, aliases, roles, config and plugin contracts remain.
- Rust and JavaScript versions pass the same fixtures.
- CPU-heavy work does not execute synchronously on the Zalo event loop.
- Native failures fall back safely and are visible in diagnostics.
- CI builds on supported targets before production rollout.
- Benchmarks separate local CPU/queue time from Zalo network/API latency.

Rust cannot remove Zalo server response time, internet latency or upload time.
