# isextensionready — readiness signal design

> Backend design for a site/badge that answers: **"Is this Extension.js CLI build ready to be called stable?"**
>
> Design material for the readiness backend. The schema (`readiness.schema.json`)
> is the contract a CI run emits and the site renders; nothing here executes at
> build/test time. References to `_FUTURE/examples/` below point at the vendored
> checkout of the separate `extension-js/examples` repo.

## TL;DR

The test estate is **strong but scattered across two repos and three tiers**,
with **no single machine-readable verdict** and **no version pin** between a CLI
commit and the acceptance/stability suites that judge it. The work is *not*
"write more tests" — it is **consolidate the signal that already exists into one
document keyed to a CLI commit SHA.** That document (`readiness.schema.json`) is
this site's backend.

## The estate: 3 tiers, 2 repos

| Tier | Repo | Tech | Runs on | What it proves |
|---|---|---|---|---|
| **1 — unit/integration** | `extension-js/extension.js` (this repo) | vitest, ~975 cases / 230 specs | **PR + push** (`ci.yml`) | deterministic logic: manifest, resolve, css, parsing, mocked CDP/RDP |
| **2 — acceptance e2e** | `extension-js/examples` | Playwright, 14 batched projects, ~50 templates × 8 cross-cutting specs | examples CI (per examples branch) + **this repo nightly** via `hydrate-templates-from-examples.sh` | real Chrome (CDP) + Firefox (RDP): HMR, hard-reload, content reinject, shadow DOM, CSS compile, multi-browser build |
| **3 — stability gates** | `extension-js/examples` | 12 `assert-*`/`verify-*` scripts + `reload-matrix/` | examples CI (most) + manual/publish-gate (reload-matrix) | the literal meaning of "stable" (see table below) |

### Coupling problem (the core gap)

- The CLI repo consumes Tiers 2+3 by `git clone --depth 1` of `examples@main`
  at **nightly** cadence. The only thing tying a verdict to a CLI commit is a
  manual `"Bump Extension.js"` commit in the examples repo.
- examples-repo CI gates **examples** changes, not **CLI** changes.
- Net: you can answer *"did examples@main pass against CLI@main overnight"* but
  not *"is CLI commit `<sha>` ready"*. The readiness doc fixes this by recording
  both SHAs in `meta` (see schema `meta.cliCommit` + `meta.examplesCommit`).

## Tier-3 stability gates → contract enforced → readiness dimension

Grounded by reading each script's header and the examples `ci.yml`.

| Script (`_FUTURE/examples/scripts/`) | Contract it pins | Dimension | In examples CI? |
|---|---|---|---|
| `assert-canary-one-run-builds.mjs` | a freshly published canary builds every example in **one** invocation (no install-then-rebuild dance) | `build.oneRun` | ✅ `build-and-lint` |
| `assert-canary-runtime-installed.mjs` | installed `extension` canary resolves its `extension-develop` runtime from its **own** `node_modules`, never an outer monorepo (resolver-escape regression) | `runtime.resolution` | ❌ **orphaned** — referenced by no examples workflow |
| `assert-stable-install-modes.mjs` | stable install works across **pnpm/npm/yarn/bun** | `install.modes` | ✅ `optional-deps-guards` |
| `assert-stable-pnpm-postcss-repro.mjs` | pnpm strict-hoisting + postcss does not break the build (known repro) | `install.pnpmPostcss` | ✅ `optional-deps-guards` |
| `assert-optional-deps-canary-matrix.mjs` | optional deps resolve per package manager (`--pm <pnpm\|npm\|yarn\|bun>`) | `install.optionalDeps` | ✅ `optional-deps-ecosystem.yml` |
| `assert-pnpm-monorepo-dev.mjs` | `extension dev` works inside a pnpm-workspace monorepo (transitive HMR deps not hoisted → must use absolute paths) | `dev.monorepo` | ❌ **orphaned** — referenced by no examples workflow |
| `assert-create-dev-workflow.mjs` | scaffold → `dev` works for a named subset | `create.devWorkflow` | ✅ `create-dev-workflow-guards-windows` |
| `assert-create-dev-workflow-all-templates.mjs` | scaffold → `dev` works for **every** template | `create.devWorkflowAll` | ✅ `create-dev-workflow-guards` |
| `verify-content-template-first-dev.mjs` | first `dev` run of a content template injects correctly (chromium) | `dev.firstRunContent` | ✅ (`test:content-react`) |
| `verify-content-live.mjs` | live content-script update (default firefox) | `reload.contentLive` | partial |
| `verify-full-extension-reload.mjs` | full extension reload (`--browser` chromium/firefox) | `reload.full` | partial |
| `verify-dev-reload-suite.mjs` | aggregate dev-reload suite | `reload.suite` | partial |

### reload-matrix (`scripts/reload-matrix/`) — quantified reload correctness

The most product-relevant gate. Attaches a passive CDP observer to real Chrome,
makes a controlled edit, and **counts** service-worker restarts (`sw`) and
extension-page navigations (`nav`) against per-scenario expectations. Maps 1:1
to what a user sees (`sw=1 nav=0` = silent reload, etc.).

- **6 scenarios today**: `locales-single-edit-popup-{closed,open}`,
  `locales-rapid-edits-popup-closed`, `manifest-edit-popup-closed`,
  `popup-html-edit-popup-{open,closed}`.
- **Modes**: `local` (CLI from `programs/extension/dist`), `remote` (published
  `extension@<tag>` via npx — the **publish gate**).
- **Not in `ci.yml`** — inner-loop + publish-gate only. Candidate to promote a
  `:smoke` subset to a PR gate (see below).
- Doc drift: `README.md` references `RELOAD_MATRIX.md` as the doc-of-record, but
  that file does not exist at the examples root. Either generate it from
  `scenarios.mjs` or drop the reference.

## examples-repo CI jobs (Tier 2+3 today)

`build-and-lint` · `optional-deps-guards` · `create-dev-workflow-guards`
(+`-windows`) · `dev-reload-chromium` (`--project=dev-live`, xvfb) ·
`dev-reload-firefox`. All gate the **examples** repo only.

## Known standing red (must be modeled, not hidden)

`_FUTURE/examples/TESTING_RESULTS.md` documents **content (28)** and
**newtab (27)** batches failing in **headless**; green requires headed + xvfb.
A readiness verdict must classify these as `infra-flake` vs `code-red` (schema
`results[].classification`) or the badge will lie.

## The plan (consolidation, not expansion)

Status reflects branch `qa/readiness-gates`.

1. ✅ **`readiness.schema.json`** (this folder) — the one machine-readable
   document, keyed to `cliCommit` + `examplesCommit`. Validates against the
   repo's `ajv`. `verdict` is computed from a declared `gatingPolicy`.
2. ✅ **Pin the coupling (mechanism)** — `hydrate-templates-from-examples.sh`
   now honors `EXAMPLES_REF` (default `main`, backward-compatible) and writes
   the resolved SHA to `templates/.examples-commit` for `meta.examplesCommit`.
   *Remaining:* set `EXAMPLES_REF` in the nightly/e2e workflows to a pinned ref.
3. ⏳ **Promote a fast subset to the CLI PR gate** — `reload-matrix:smoke` + one
   chromium acceptance batch. *Deferred:* needs hydration + browser install at
   PR time; design a minimal opt-in workflow before enabling (heaviest item).
4. ✅ **Classify infra-flake vs code-red** — modeled in the schema
   (`results[].classification` + `gatingPolicy.flakeHandling`).
5. **Cheap nets (this repo):**
   - ✅ **lint + typecheck CI job** (`ci.yml` → `quality`). Neither ran before.
     The typecheck gate immediately caught + we fixed two bad `./types` imports
     in `plugin-css` (now `../types`).
   - ✅ **unit-test the readiness producers** — `ready-message.ts`,
     `content-script-contracts.ts`, `instance-registry.ts` now covered by
     `programs/extension/browsers/__spec__/readiness-producers.unit.spec.ts`
     (13 tests, green).
   - ⏳ **snapshot the 21 `messages.ts` catalogs** — not yet; next cheap net.

### Confirmed orphaned (manual-only, in no examples workflow)

`assert-canary-runtime-installed.mjs`, `assert-pnpm-monorepo-dev.mjs`, and the
whole `reload-matrix/` are valuable gates that **no CI invokes**. Wiring at
least their smoke forms into examples CI (and surfacing them as `results[]`
rows) is high-ROI. Also: `reload-matrix/README.md` cites a `RELOAD_MATRIX.md`
doc-of-record that does not exist — generate it from `scenarios.mjs` or drop the
reference.

See `readiness.schema.json` + `readiness.example.json` for the contract.
