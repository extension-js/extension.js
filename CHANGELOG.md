# Changelog

## Unreleased

- Bump ws to ^8.20.1 to patch GHSA-58qx-3vcg-4xpx (45025a47)
- Restore the @rspack/dev-server@2.0.2 SCAFFOLD_OVERRIDES workaround (d301b670)
- Raise perf-budget defaults to 512/512/1024 KiB (13180c1a)
- Ensure `build` also produces the extension.d.ts file (0b682489)
- Drop the scaffold-overrides workaround for the @rspack/dev-server 2.0.2 break (5832ecc9)
- Fix the three CI failures revealed once the lockfile was synced (65afc502)
- Refresh pnpm-lock.yaml for the ws control-bridge dependency (568d0ddb)
- Remove the implemented readiness design docs (7513e9ad)
- Snapshot the 21 messages.ts catalogs (readiness item 5c) (ffb39acf)
- Surface real CDP port into ready.json for out-of-process source inspect (6e39ba38)
- Remove the implemented agent bridge and distribution design docs and fix code comments (df3bc426)
- Add the extension publish command for a shareable url (f4cf02b6)
- Inspect extension surface dom through the in bundle relay (c6171406)
- Pierce closed shadow roots in dev source deep dom (60c343a0)
- Add the agent bridge act and inspect slices with multi context logs (53b5aac6)
- Add the extension logs command to read and stream the bridge (54b9f62b)
- Add the agent bridge consumer client and ready contract reader (23e88e09)
- Forward background console output over the control websocket (0da0b475)
- Declare the ws dependency for the control bridge (3d2365ba)
- Add the agent bridge slice 1 control websocket broker and log file (9857bfa5)
- Declare webpack devDep in develop so typecheck gate resolves the vendored HMR fork (1c4d0316)
- Add CI lint/typecheck gate, readiness schema, producer tests, and reload-matrix smoke (178ef63b)
- Enhance zip download mechanism (6f204f17)
- Unify package-manager detection across yarn and bun (f25a3d06)
- Bundle default `create` template, fix package-manager detection and network timeouts (80abf7db)
- Add (alpha) Safari target support and Chromium/Firefox runner hardening (441eea3f)
- Review cleanup of extension package (35e10b52)
- Develop plugin review cleanup, hardening, and browser process shim (3c4a5529)

## 3.8.2

- Harden optional dependency runtime resolution to reduce first-run failures.

## 3.8.1

- No user-facing changes beyond release packaging updates.

## 3.8.0

- Add support for canary releases.
- Add an experimental `install` command.
- Improve Windows test and runtime reliability across Chromium, Edge, and Firefox flows.
- Improve path handling and source output behavior for more consistent CLI runtime output.
- Stabilize remote zip/template handling and companion loading defaults.
- Improve extension developer feedback by making Extension ID output more reliable and less noisy.

