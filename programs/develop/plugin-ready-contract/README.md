[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-ready-contract

> The session contract: `ready.json` and `events.ndjson`, the machine-readable state of a `dev`, `start`, `preview` or `build` run.

### What it does

- **ReadyContractPlugin**: Hooks compiler lifecycle and writes deterministic metadata to:
  - `dist/extension-js/<browser>/ready.json`
  - `dist/extension-js/<browser>/events.ndjson`
- **createReadyContractWriter**: The writer behind the plugin. The dev server and `preview` also open one directly, for the stamps no compile makes (the runtime attach and detach, a reload, the end of the launch, the shutdown).

### Contract

`ready.json` fields (stable for automation):

- `status`: `starting` | `ready` | `error` | `stopped`. Under `start` with a
  browser to launch, the build leaves `status: starting` with `compiledAt` set,
  and `ready` is stamped only once the launch passed its binary checks. Under
  `dev` with a browser to launch, the compile leaves `status: starting` with
  `compiledAt` set the same way, and `ready` follows once the launcher stamped
  the browser it started: `browserPid`, `binary`, `profilePath` and the
  debugger port, `cdpPort` on Chromium or `rdpPort` on Firefox. A `ready`
  record with a pid and no port means the launch is over and the session holds
  no debugger port, with `cdpFaultCode` or `rdpPortError` beside it when a
  fault is the reason, and one with no `browserPid` names a session that
  launched no browser (`--no-browser`, a dry run). `executorAttachedAt` can follow
  `ready`, unless the session takes act verbs, where `ready` waits for it up to
  10 seconds
- `command`: `dev` | `start` | `preview` | `build`
- `schemaVersion`: `2`, the version of this contract, and `schema`: `1`, the
  result envelope the engine speaks
- `browser`
- `runId`
- `startedAt`
- `distPath`
- `manifestPath`
- `port`
- `pid`
- `ts`: when `status` was last written. Every caller moves it only with the
  status, never for a fact stamped beside it, so a reader can date the status
  by it
- `compiledAt`
- `errors`: the last failed compile's messages as plain text (no color),
  whether the compile reported errors or the compiler itself failed, empty
  otherwise
- `controlPort`: the agent-bridge control port, or `null` when there is none
- optional `code` and `message` on failures
- `toolchainVersion`, and optional `extensionName` and `extensionVersion`: the
  manifest a `dev` or `preview` run loads from the dist, or the one a `build` or
  `start` compiles from the source
- optional `extensionId` and `extensionIdSource`: `browser` when the browser
  confirmed it, `packager` for the Safari bundle id, `derived` when read off the
  dist. Only a derived id is ever recomputed
- optional `host`, `instanceId`, `instanceExplicit`, `controlPath` and `logsPath`
- optional `managedExtensions`: every extension the engine loads besides the
  user's, each with its `path` and `id`
- optional `devAdditions`: under `dev`, every grant, browser flag and browser
  preference the session has that the production build does not, with its reason
- optional `runtime` (`attached` | `detached`), `executorAttachedAt`,
  `executorDetachedAt` and `extensionBaseUrl`: stamped when the extension's
  background connects and leaves. `awaitingExecutorSince` is present while
  `ready` waits for the first connection
- optional fields the browser launcher stamps after launch: `cdpPort`,
  `rdpPort` and `rdpPortError`, `profilePath`, `profileReused`, `browserPid`, `launcherPid`,
  `binary`, `binaryProvenance`, `binaryPinnedBy`, `safari`,
  `webdriverRequestPath`, `startingUrl`, `startingUrlOpened` and
  `startingUrlUnopenedReason`, `browserExitedAt`, `browserExitCode` and
  `browserExitSignal`, `browserLaunchFailedAt`, `browserLaunchFailedReason` and
  `browserLaunchFailedCode`, `browserUpNotAttachedAt`,
  `browserUpNotAttachedWaitMs` and `browserUpNotAttachedHint`, and
  `extensionLoadRefusedAt`, `extensionLoadRefusedReason` and
  `extensionLoadRefusedCause`, and `profileLockedAt` and `profileLockOwner`.
  Every field the launcher stamps is kept across recompiles of the same run,
  including one this list does not name yet. `browserUpNotAttached*` and
  `extensionLoadRefused*` reset when the run starts again
- a browser verdict is kept across recompiles: once the launcher wrote `status:
  error` with a code of its own (`browser_exited`, `browser_launch_failed`,
  `profile_locked`, `extension_load_refused`), a compile that succeeds leaves
  that status, code and message as they are. Only `compile_error` and
  `compile_failed` are cleared by the next good compile
- optional `engine: emulator` with `browserPid: null` for an emulator run
- optional `controlPortUnavailableReason`: the bind error, present whenever
  `controlPort` is `null` because the control bridge could not start. It is part
  of every write for the session, so a recompile never drops it
- optional `webdriverPort` and `webdriverSessionId`: under `dev --browser safari`
  the launcher holds one `safaridriver` session beside the app and stamps it
  here. Safari allows one automation session at a time, so a client attaches to
  this one instead of opening its own. Both are preserved across recompiles and
  the session, its `safaridriver` and the Safari automation instance it raised
  all end with the dev process, a Safari the user had open stays
- optional `webdriverUnavailableReason`: why no session was opened (Allow Remote
  Automation off, `safaridriver --enable` not run, no `safaridriver`), present
  instead of the two fields above and preserved across recompiles
- optional `reloadedAt`, `reloadKind` and `reloadLabel`: under `dev`, stamped
  each time dev applies a reload after a compile. `reloadKind` is `full`,
  `background`, `content`, `page` or `safari-resync` (the rebuilt Safari appex),
  and `reloadLabel` is the label the reload line prints. A reload the extension
  never confirmed or never received is not stamped, and a compile that
  reloads nothing leaves the stamp as it was. A compile's reload is live once
  `reloadedAt` is later than that compile's `compiledAt`. Preserved across
  recompiles
- optional `cdpFaultCode` and `cdpFaultMessage`: under a Chromium `dev`,
  `start` or `preview` the launcher stamps them when the CDP wire failed after
  the browser came up (a connect that found no endpoint, a command or load
  that timed out, an id it could not resolve). The session stays `ready`
  because the browser is up, but reload and HMR cannot attach until the fault
  is fixed. The `ready` frame under `--output json` carries the same fault on
  `warnings` as `code: message`. The code is a warning name:
  `W_CDP_NOT_CONNECTED`, `W_CDP_TIMEOUT`, `W_CDP_OP_FAILED`,
  `W_BROWSER_CONNECTION_CLOSED` or `W_EXTENSION_ID_UNKNOWN`. Both are
  preserved across recompiles of the same run
- `pidStartedAt`, and optional `browserStartedAt` and `launcherStartedAt`: when
  the process behind `pid`, `browserPid` and `launcherPid` started (ISO 8601
  UTC). A pid is reused once its owner exits, so a reader that finds a pid
  alive compares this with the process table's current answer, with a couple
  of seconds of tolerance, before treating the process as the session's. Each
  is read once per pid and kept across recompiles of the same run.
  `pidStartedAt` is always present: the dev server reads it from `ps -o lstart`,
  and from its own clock on Windows or where `ps` is missing, which is the same
  instant within milliseconds. The browser and launcher times come from the
  process table (`ps -o lstart`, or the .NET `Process.StartTime` on Windows,
  bounded at 5 seconds) and are absent when it could not date the process
- `pidStartId`, on Linux only: the boot id and the kernel's start tick of
  `pid` (`/proc/sys/kernel/random/boot_id` and field 22 of `/proc/<pid>/stat`),
  joined by a colon. `ps -o lstart` on Linux is the wall clock as it reads now
  minus the process age, so a clock step (a resumed VM, WSL2) moves it and a
  live session would read as a reused pid. This value does not move, so a
  reader that can read it for the live pid compares it for equality and skips
  the dates
- `browserStartId` and `launcherStartId`, on Linux only: the same value for
  `browserPid` and `launcherPid`, stamped by the launcher beside each start
  time and absent when the process table could not be read

`events.ndjson` events (the file is reset at every run start and holds the
current run only, join on `runId` to correlate across runs):

- `compile_start`
- `compile_success`
- `compile_error`
- `browser_exited`
- `browser_launch_failed`
- `restart_failed`
- `warning`
- `shutdown`

Every row carries `type`, `ts`, `command`, `browser` and `runId`. A
`compile_error` row adds `errorCount` and up to ten `errors`, and a `browser_exited`
row adds `exitCode`, `exitSignal` and `browserExitedAt`. A
`browser_launch_failed` row adds `browserLaunchFailedAt` and `reason`, and the
contract it mirrors reads `status: error` with `code: browser_launch_failed`.
A `warning` row is something the session warned about between two compiles, such as a reload the extension never confirmed. It adds the warning `code` and the `reason`.
A `restart_failed` row is a dev restart that could not be made (a config or
entry change whose next compiler or server failed). It adds the error `code`,
the `reason` and `serving`: `true` when the build from before the restart
still serves the session, which then retries on the next change, and `false`
when no server is left and the session ends.

The stream is bounded like `logs.ndjson`: it rotates at 8 MB or 50,000 lines
into `events.1.ndjson` through `events.3.ndjson`, and a single row over 64 KB
has its text trimmed (each error and any other long field such as `reason`)
and is marked `truncated: true`. Every row stays
valid JSON, so a consumer always parses line by line.

### Usage

In bundler config (`dev`/watch-oriented):

```ts
new ReadyContractPlugin({
  packageJsonDir,
  browser, // optional (defaults to "chromium")
  mode, // used to derive command when command is omitted
  outputPath,
  manifestPath,
  port,
  // command: "dev" // optional explicit override
})
```

In run-only command flows:

```ts
const metadata = createReadyContractWriter({
  packageJsonDir,
  browser,
  command: 'preview',
  distPath,
  manifestPath,
  port: null
})

metadata.writeStarting()
// ... command work ...
metadata.writeReady()
// ... or on failure ...
metadata.writeError('preview_manifest_missing', 'Expected manifest at ...')
```

### One writer

`lib/ready-contract-writer.ts` is the only module that writes `ready.json`. It owns the atomic write (a temp file renamed over the target), the retry of a rename that a Windows reader holds (the `renameRetry` seam), the carry of every field it did not compute across a rewrite, and the identity fields (`pid`, `pidStartedAt`, `pidStartId`, and the browser and launcher pid, start time and start id).

Three callers hand it a patch and write nothing themselves:

- this folder, for the status and everything a compile or the dev server learns
- `plugin-browsers/launch-timeout-stamp.ts`, for a launch the compile stopped waiting for
- `programs/extension/browsers/browsers-lib/ready-stamp.ts`, the CLI browser launcher, which compiles the writer into its own bundle

The same module is the only reader. `readReadyRecord` answers the record, or nothing for a missing, half-written or wrong-shape file, and `tryReadReadyRecord` also answers the parse error, which `dev --wait` reports when it times out. `doctor`, the run card, `preview`, the lifecycle stream, the live session check and the published `readReadyContract` and `readReadyContractDocument` all take the record from it. Specs read the file by hand on purpose, as the check on the module.

`__spec__/ready-contract-one-writer.spec.ts` fails when a second write, rename, read or parse of the file appears in either program, or a second rename retry.

### Notes

- A write that fails (a file where the output folder goes, a read-only dist)
  prints one warning naming the file and the error code. It is said again only
  after a write to that file succeeded in between.
- A live dev session owns its contract while its `pid` is alive and started
  at `pidStartedAt` (within 2 seconds). Where the contract carries
  `pidStartId`, that decides instead and the dates are not read. A reused pid
  owns nothing, so a build beside it writes its own receipt.

- Keep extension payload clean: metadata lives under `dist/extension-js/*`, not `dist/<browser>`.
- For scripts/agents, parse these files instead of terminal output.
