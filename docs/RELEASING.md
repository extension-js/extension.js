# Releasing

This repo uses a GitHub Actions release workflow to publish the public packages.

## Channels

- Stable: npm dist-tag `latest` (GitHub environment: `stable`)
- Next: manual pre-release channel with npm dist-tag `next` (GitHub environment: `next`)
- Canary: manual silent channel with npm dist-tag `canary` (GitHub environment: `canary`)

## Scope (public packages)

- `programs/extension` → package: `extension`
- `programs/create` → package: `extension-create`
- `programs/develop` → package: `extension-develop`
- `programs/install` → package: `extension-install`

All other packages are private and not published.

## Workflow

### 1) Publish workflow (manual)

Use the `Extension.js – Release Publish` workflow at `.github/workflows/publish-release.yml`.

- Trigger: `workflow_dispatch` with inputs:
  - `channel`: `next`, `stable`, or `canary`
  - `version`: explicit semver (for example `4.1.42-next.1` or `4.1.42`).
    - For `canary`, this can be left empty to auto-generate:
      `<next patch>-canary.<run_number>.<short_sha>`, named for the patch after
      the last release so it sorts above the published stable
  - `draft`: creates the GitHub Release as a draft for manual review before it goes
    public (`stable` and `next` only, default `false`)
- For `stable` and `next`, CI first moves the `extension create` template pin to the
  head of `extension-js/templates` (`node scripts/generate-template-corpus.mjs --ref main`)
  and carries the two generated files in the release commit, so a fresh scaffold
  matches the corpus the release was cut against. The bundled `javascript` template
  drift check then runs against that pin and fails the release if the bundled copy
  needs a resync. A template added to the corpus still needs curating by hand
  (groups and the AI-help snapshot) before a release, and the tests fail the cut
  with that reason. `EXTENSION_SKIP_TEMPLATE_REPIN=1` keeps the committed pin for an
  urgent release.
- A `stable` release is one dispatch, gated twice. Before anything is tagged, the
  workflow needs the canary on npm that was built from the same commit. When there
  is none it dispatches the canary run itself and waits for the version. Then two
  gates run with that canary, side by side:
  - `corpus-gate` builds every buildable sample of `extension-js/corpus` on
    Chrome, Firefox and Edge, and for Safari on a macOS runner.
  - `templates-gate` runs the whole `extension-js/templates` suite: every example
    built, installed with each package manager and driven in real browsers, and
    every example built for Safari on a macOS runner.

  The Safari lanes run the converter and `xcodebuild` and open no browser, so they
  prove the Safari build, not the run.

  A failure in either stops the release with nothing tagged and nothing published.
  If main moved after the dispatch, the run stops and says so. `skip_corpus_gate`
  publishes without both gates and is for a broken gate only, never for a
  regression.
- Every run, on every channel, repeats both readings with the exact version it
  published (jobs `corpus-published` and `templates-published`). On a canary that
  is the verdict to read before a stable. On a stable it proves the shipped
  version. They run after the publish, so a failure turns the run red and
  unpublishes nothing. On a stable the corpus reading skips Safari, which the
  gate before the publish already read from the same source.
  The one exception is the canary a stable run cuts for itself. It is dispatched
  with `readings=false`, because that stable's gates read the same version at
  the same pins.
- The notes of a stable release end with a line that names the canary the gates
  read and links the run, or says the gates were skipped.
- Both repositories are pinned by commit in `publish-release.yml`, in each `uses:`
  line and in the `ref:` input beside it. `node scripts/bump-release-gates.mjs`
  moves every pin to the head of its repository, and a spec fails when the pins of
  one repository differ. The E2E smoke on `main` reads the templates at the same
  commit (`PINNED_EXAMPLES_REF` in `e2e-smoke.yml`), and the command moves it too.
  The pin fixes the templates only: each template still installs its dependencies
  with no lockfile, so a new upstream release can still reach the smoke. The `Release gates freshness` workflow checks weekly,
  builds a new corpus head with the latest stable, and opens an issue when a pin
  is behind. It cannot push the change, because the Actions token may not edit
  workflow files.
- CI builds the packages, runs the tests, then validates the inputs.
- Release notes are generated from git history using `scripts/generate-release-notes.mjs`.
  Stable and next releases use grouped, user-facing bullets with commit refs, while
  release-machinery and internal pipeline commits are omitted (extend
  `IGNORED_PATTERNS` in that script when adding commits that should never appear in
  published release bodies).
- Versions are set for:
  - `programs/extension/package.json`
  - `programs/develop/package.json`
  - `programs/create/package.json`
  - `programs/install/package.json`
- CI publishes `extension`, `extension-develop`, `extension-create`, and `extension-install` to npm
  using the selected dist-tag (`latest`, `next`, or `canary`).
- For `stable` and `next`, CI tags the release as `v<version>`, creates a GitHub
  Release, and creates a GitHub Deployment.
- For `canary`, CI intentionally skips git tag/commit/push, GitHub Release
  creation, changelog updates, and GitHub Deployment creation.

## Notes

- npm authentication: the workflow publishes through npm trusted publishing with GitHub OIDC
  (`id-token: write`) and `--provenance`. It reads no npm token.
- `next` releases must use a pre-release semver (validated in CI).
- `stable` releases must use a clean semver (validated in CI).
- `canary` releases must use a pre-release semver (validated in CI).
- `canary` is intentionally silent: no release notes broadcast and no GitHub
  release event.
- Stable Discord notifications are sent directly from the publish workflow.

## Optional hardening implemented

- The dist-tag is always passed explicitly. The workflow resolves it from the channel
  (`latest`, `next`, or `canary`) and hands it to `scripts/npm-publish.sh`, which runs
  `npm publish --tag <dist-tag>` for each public package (`extension`,
  `extension-develop`, `extension-create`, `extension-install`). No package sets
  `publishConfig.tag`.
- Input validation for channel/version in the release workflow.

## Environments

- `stable`: stable releases (`latest`)
- `next`: next releases (`next`)
- `canary`: silent canary releases (`canary`)

Configure under Settings → Environments. They can be identical or protected with required reviewers.

## References

- React repo practices: `facebook/react`
- Changelog style inspiration: `facebook/react` CHANGELOG
