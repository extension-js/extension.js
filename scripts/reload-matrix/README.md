# reload-matrix

Ground-truth reload measurement for Extension.js dev. Each scenario runs the
real dev pipeline end-to-end against a real fixture in `examples/`,
attaches a passive CDP observer to the launched Chrome, performs a controlled
file edit, and counts the actual lifecycle events the user would see.

The matrix is the executable counterpart of `RELOAD_MATRIX.md` at the root of
this workspace. When the documented expectation drifts from runtime reality,
the matrix flips to FAIL with the specific cell.

## Run modes

| Mode | What it tests | When to run |
| --- | --- | --- |
| `local` (default) | The CLI built from `programs/extension/dist/cli.cjs` in this monorepo. | Inner-loop while iterating on reload-pipeline fixes. |
| `remote` | The published `extension@<tag>` from npm, fetched via `npx`. | Publish gate — verifies the canary that was just uploaded behaves the same as local. Catches packaging bugs (missing files, broken bin entry, wrong cross-package deps). |

```sh
# from _FUTURE/examples
pnpm test:reload-matrix              # local mode, 3 reps per scenario
pnpm test:reload-matrix:smoke        # one scenario, full event timeline printed
pnpm test:reload-matrix:remote       # remote mode against extension@canary

# environment knobs
RELOAD_MATRIX_REPEAT=5 pnpm test:reload-matrix
RELOAD_MATRIX_FILTER=locales pnpm test:reload-matrix
RELOAD_MATRIX_TAG=next pnpm test:reload-matrix:remote
```

## What it measures

For every scenario the harness reports two counts attributed to the user
extension origin (companion-extension noise is filtered out):

- **`sw`**: service-worker restarts. Computed as `min(serviceWorkerCreated, serviceWorkerDestroyed)` for the user's `chrome-extension://<id>/` origin between the first edit and the post-edit quiescence point.
- **`nav`**: extension-page navigations. The number of `Page.frameNavigated` events for the user origin during the same window.

These are the signals that map 1:1 to what the user sees:

- `sw=1 nav=0` — the extension reloaded silently (action button blink, popup closes if open).
- `sw=0 nav=1` — an open extension page refreshed via livereload; SW state preserved.
- `sw=0 nav=0` — no visible disruption (HMR applied a module update, or no open page existed).
- `sw=N nav=M` with N or M unexpectedly high — the bug we're hunting.

## Adding a scenario

Edit `scenarios.mjs`. Each row is a JS object with:

- `name`: short label.
- `fixturePath`: absolute path; resolve via `resolveTemplateFixture('<template>')`.
- `openPages`: array of relative URLs inside the extension (e.g. `'action/index.html'`) the harness opens before the edit. Use this to put pages in the user-observable state for the scenario.
- `edits`: sequence of `{relativePath, transform, waitMsAfter}` records. `transform(current)` returns the new file contents.
- `expected`: any combination of:
  - `serviceWorkerRestarts: number` — exact count.
  - `serviceWorkerRestartsAtMost: number` — upper bound, for cases Chrome may legitimately exceed by 1 under memory pressure.
  - `extensionPageNavigations: number` — exact count.
  - `extensionPageNavigationsAtMost: number` — upper bound.

Cross-reference the new row against `RELOAD_MATRIX.md`. If the doc's cell is
wrong, update it in the same commit so the doc and the runtime match.

## How it works

1. The fixture is copied to a temp directory so edits never leak back into the repo.
2. `dev` is spawned as a child process; stdout is parsed for the CDP debug port and the dev banner.
3. `cdp-observer.mjs` connects a second CDP client to the same browser via `/json/version` and subscribes to `Target.setAutoAttach`. It is passive — it never sends commands that mutate state.
4. After a startup quiescence window, the harness records the event count baseline, opens any requested pages, performs edits, and waits for a post-edit quiescence window.
5. Events are bucketed by extension origin and the user origin is identified by the `Extension ID <id>` line in the dev banner.
6. Cleanup: dev process killed (SIGTERM → SIGKILL after 4s), observer WebSocket closed, temp directory removed.

## Troubleshooting

- **"Local CLI build not found"**: run `pnpm --dir programs/extension run compile` from the monorepo root.
- **"Timed out waiting for CDP debug port"**: dev failed to launch. Run `node scripts/reload-matrix/run-smoke.mjs` to surface the dev process stdout/stderr.
- **Flaky scenarios on Linux CI**: bump `RELOAD_MATRIX_REPEAT` and watch for genuine non-determinism vs. timing slack. The harness's quiescence windows are conservative but not infinite.
