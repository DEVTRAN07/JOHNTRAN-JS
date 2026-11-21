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

## Later migration order

1. Pure CPU helpers: normalize payloads, validate values and deterministic
   formatting. Keep JS parity fixtures for each operation.
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
