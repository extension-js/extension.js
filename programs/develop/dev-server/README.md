[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# dev-server

> The `extension dev` session: ports, the control bridge, the compiler and the rspack dev server, restarts and shutdown.

`command-dev.ts` calls `devServer(projectStructure, devOptions)` from `index.ts`. One call is one session. It returns once the first server has started and lives until the process ends.

### What this folder owns

- **Ports.** `port-manager.ts` picks the HTTP port on the bind host (the first free one of 20, starting at the requested port or at 8080) and holds it from before the compile until the server listens (`reserved-listen.ts`), because the port is baked into the build. A restart keeps the same port.
- **One session per browser.** A live session that owns the same `ready.json` makes a second one fail with `E_SESSION_EXISTS`.
- **The control bridge.** `control-bridge-start.ts` opens the WebSocket control server (`control-bridge/`) on the previous session's port when it can, else on a free one. When neither binds, the session says so and runs without reload. The bridge carries frames and control verbs. `producer-runtime.ts` is the producer's connection, verbs and logs, and the reload executor it composes comes from `plugin-reload/reload-lib/producer-reload.ts`.
- **Hosts and headers.** `cors.ts` builds the allowed-hosts list from the connectable host, the emulator viewer and `--allowed-hosts`, reflects `Access-Control-Allow-Origin` for the session's own extension only, and replaces the stock host check with one that names the refused host and the fix. It also replaces the stock cross-site check with one that serves a browser request only when it comes from the session: the server's own address, a host named with `--allowed-hosts` on the dev server's own port or on the address a proxy names in `Host` or `X-Forwarded-Host`, the emulator viewer or the session's extension. A request with no fetch metadata passes, as it does through the stock server. The reload socket listens at `/ws/<instance id>`, the path each session builds into its own extension, so no other extension or session finds it. An upgrade at any other `/ws` path gets a 404 with a one-line reason at once, so a build from an earlier session does not wait out its handshake. It opens for the same web origins and for any extension that dials that path, since the session's extension dials before it is known.
- **Restarts.** A plugin that finds an entrypoint change asks `session-restart.ts` for a restart. `session-restart-handler.ts` builds the next compiler and server, stops the old server, starts the new one and sends one full reload. `main-world-restart.ts` restarts a session whose MAIN world script set changed, once the edit settles, and `session-restart-holds.ts` marks the builds that restart replaces. The dev server hands that hold to the reload session in `plugin-reload` with the broker, so no build it marks reloads.
- **Output pruning.** `session-start-prune.ts` removes what an earlier session left in `dist/<browser>`. `session-gone-outputs.ts` removes the outputs of entries a restart dropped.
- **Shutdown.** `cleanup.ts` stops the server on `SIGINT`, `SIGTERM` and `SIGHUP`, exits non-zero on an uncaught exception, and returns a disposer that removes its listeners.
- **Output for people and machines.** `messages.ts` holds the text. `lifecycle-stream.ts` writes one frame per lifecycle step when `EXTENSION_OUTPUT=ndjson`.

### What it hands to the rspack dev server

`server-config.ts` builds the `@rspack/dev-server` configuration. The stock server owns listening, static serving of `public/` (a name the build leaves out of `public/` answers 404 here too), the HMR WebSocket at `/ws` (`hot` and `liveReload` on, client injection off) and `@rspack/dev-middleware`, which keeps compiled files in memory. Two things are set on purpose:

- `writeToDisk` writes every asset except `manifest.json` and any name with a `..` segment. The manifest plugin owns the manifest on disk and writes it whole. Nothing patches `node:fs`, so a host's own writes go through.
- `setupExitSignals: false`, because `cleanup.ts` owns the signals.

`dev-middleware-body.ts` repairs one-byte assets that `@rspack/dev-middleware` 2.0.3 serves empty.

### Environment variables it sets

| Variable | Read by |
| --- | --- |
| `EXTENSION_DEV_SERVER_PROTOCOL`, `EXTENSION_DEV_SERVER_HOST`, `EXTENSION_DEV_SERVER_PORT`, `EXTENSION_DEV_SERVER_PATH` | `lib/dev-server-client-import.ts` |
| `EXTENSION_DEV_SERVER_CONNECTABLE_HOST` | `rspack-config.ts`, `lib/dev-server-client-import.ts`, `plugin-web-extension/feature-manifest/steps/apply-dev-defaults-lib/patch-csp.ts`, `plugin-reload/steps/inject-bridge-producer.ts`, `command-build.ts` (the Playwright metadata host) |
| `EXTENSION_INSTANCE_ID` | `port-manager.ts`, `lib/messages.ts`, `plugin-reload/steps/inject-bridge-producer.ts` |
| `EXTENSION_CONTROL_PORT` | `plugin-reload/steps/inject-bridge-producer.ts`, `plugin-reload/steps/inject-bridge-relay.ts` |

### Environment variables it reads

`EXTENSION_START_TIMEOUT_MS` (start warning, 30000 by default), `EXTENSION_AUTO_EXIT_MS` and `EXTENSION_FORCE_KILL_MS` (`auto-exit.ts`), `EXTENSION_OUTPUT`, `EXTENSION_VERBOSE`, `EXTENSION_EMULATOR_ORIGIN`, and the instance id under `EXTENSION_INSTANCE_ID`, `EXTENSION_DEV_INSTANCE_ID` or `EXTJS_INSTANCE_ID`.

The compiler's file watch is set in `rspack-config.ts`, not here: `EXTENSION_WATCH_POLL=true` turns polling on and `EXTENSION_WATCH_POLL_INTERVAL` sets its interval in milliseconds (1000 by default).

### Files it writes in the project

| Path | When |
| --- | --- |
| `dist/<browser>/**` | Every compile, through `writeToDisk`. Pruned at session start and after a restart. |
| `dist/extension-js/.gitignore`, `dist/extension-js/README.md` | Once, in a folder that holds a project root marker. |
| `dist/extension-js/<browser>/logs.ndjson` | Every session, from the control bridge. |
| `dist/extension-js/<browser>/actions.ndjson` | With `--allow-control` or `--allow-eval`. |
| `.extension-js/control-port-<browser>`, `.extension-js/.gitignore` | When the control server starts. |
| `.extension-js/control-token-<browser>` (mode 0600) | With `--allow-eval`, or on a bind host beyond loopback. Removed on exit. |
| `.gitignore` | Gets `.extension-js` appended when the file exists and does not ignore it yet. |

`ready.json` and `events.ndjson` under `dist/extension-js/<browser>/` are written by the `plugin-playwright` metadata writer that this folder drives.

### Specs

`__spec__/` and `control-bridge/__spec__/`. The five compile specs that build a real project skip with the compile command when the package's `dist` is missing: run `pnpm --filter extension-develop compile` first. `dev-server-loopback.spec.ts` and `request-site-loopback.spec.ts` run the stock server on loopback with a bare compiler and need no `dist`.

## License

MIT (c) Cezar Augusto and the Extension.js authors.
