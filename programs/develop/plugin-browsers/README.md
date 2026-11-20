# `plugin-browsers`

`plugin-browsers` runs the browser of an `extension dev` session from the
compiler's `done` hook. It handles browsers only. What an edit must reload is
answered by `plugin-reload`, session restarts belong to `dev-server`, and the
launchers themselves live in the CLI (`programs/extension/browsers`). This
folder never imports `programs/extension`: the CLI injects the launcher and
the Safari packager.

## Public API

Exported from `index.ts` and `safari-dev-plugin.ts`, and through `module.ts`
for library callers:

- `BrowsersPlugin`, for Chromium and Gecko browsers. The first build that
  compiles calls the injected `BrowserLauncherFn` with
  `BrowserLaunchOptions` and keeps the `BrowserController` it returns. Each
  later build asks `plugin-reload` what to reload and sends it over the
  reload broker the dev server hands in.
- `SafariDevPlugin`, for Safari. The first build runs the full package
  (convert, xcodebuild, open, guided enable). Each later build runs a resync,
  awaited by that build so the next one never writes into the dist xcodebuild
  reads. Builds that end while a package still runs collapse into one
  follow-up. A follow-up starts outside any hook, so the next build waits for
  it in `watchRun` before it compiles, and a follow-up never starts while a
  build is compiling.
- `BuildEmitter`, the `emitter` both plugins expose and `extensionDev`
  returns. It emits `compiled` for a build the browser has, with
  `isFirstCompile` true once, for the build a browser came up with, and the
  `reloadInstruction` the save sent. It emits `error` for a failed compile,
  launch or package, with the launcher's `code` when it gave one.

## The launcher contract

- The launcher stamps the session's `ready.json` itself and may throw an
  error carrying `code` and `printed: true`, so the plugin prints nothing it
  already said.
- The launch is awaited inside `done` on purpose: the bundler starts no
  rebuild until the hook returns, so nothing writes the dist while the
  browser reads it for the first time.
- Every wait inside a compiler hook is bounded: the launch and the log
  capture at `BROWSER_LAUNCH_TIMEOUT_MS`, a retry of a refused load and a
  background wake at `BROWSER_REQUEST_TIMEOUT_MS`, the first Safari package
  at `SAFARI_FIRST_PACKAGE_TIMEOUT_MS`, a resync and the wait for a follow-up
  at `SAFARI_RESYNC_TIMEOUT_MS`. Past a bound the hook returns, the plugin
  stamps what nothing else could (`launch-timeout-stamp.ts`), and a late
  finish is still picked up. The reload itself is bounded by `plugin-reload`
  and the broker.
- The dev server hands each plugin what it owns through setters before the
  first compile: the reload broker, the restart hold, the log sink, the
  instance id, the emulator viewer URL and the ready and launch settled
  listeners.

## Boundary

Allowed imports: `plugin-reload` (its public `index.ts`), `lib/` and
`types.ts`. Whether a MAIN world restart replaces a build is the dev
server's answer, handed in through `setRestartHold`, so nothing here reads
session restart state.

## Tests

`__spec__/` drives both plugins on `fake-compiler.ts`, a watching compiler
with no bundler under it, with stand-in launchers and packagers.
`safari-package-hold.spec.ts` also runs the Safari plugin under a real
watching compiler. Nothing there launches a browser.
