# Releasing

This repo uses a GitHub Actions release workflow to publish the public packages.

## Channels

- Stable: npm dist-tag `latest` (GitHub environment: `stable`)
- Next: manual pre-release channel with npm dist-tag `next` (GitHub environment: `next`)
- Canary: manual silent channel with npm dist-tag `canary` (GitHub environment: `canary`)

## Scope (public packages)

- `programs/cli` → package: `extension`
- `programs/create` → package: `extension-create`
- `programs/develop` → package: `extension-develop`

All other packages are private and not published.

## Workflow

### 1) Publish workflow (manual)

Use the `Release – Publish` workflow at `.github/workflows/publish-release.yml`.

- Trigger: `workflow_dispatch` with inputs:
  - `channel`: `next`, `stable`, or `canary`
  - `version`: explicit semver (e.g. `3.0.0-next.17` or `3.0.0`).
    - For `canary`, this can be left empty to auto-generate:
      `<base>-canary.<run_number>.<short_sha>`
- CI validates inputs, builds, and runs tests.
- Versions are set for:
  - `programs/cli/package.json`
  - `programs/develop/package.json`
  - `programs/create/package.json`
- CI publishes `extension`, `extension-develop`, and `extension-create` to npm
  using the selected dist-tag (`latest`, `next`, or `canary`).
- For `stable` and `next`, CI tags the release as `v<version>`, creates a GitHub
  Release, and creates a GitHub Deployment.
- For `canary`, CI intentionally skips git tag/commit/push, GitHub Release
  creation, changelog updates, and GitHub Deployment creation.

## Notes

- npm tokens: use automation tokens in `NPM_TOKEN` secret.
- `next` releases must use a pre-release semver (validated in CI).
- `stable` releases must use a clean semver (validated in CI).
- `canary` releases must use a pre-release semver (validated in CI).
- `canary` is intentionally silent: no release notes broadcast and no GitHub
  release event.

## Optional hardening implemented

- `publishConfig.tag: "latest"` explicitly set in public packages
  (`extension`, `extension-develop`, `extension-create`).
- Input validation for channel/version in the release workflow.

## Environments

- `stable`: stable releases (`latest`)
- `next`: next releases (`next`)
- `canary`: silent canary releases (`canary`)

Configure under Settings → Environments. They can be identical or protected with required reviewers.

## References

- React repo practices: `facebook/react`
- Changelog style inspiration: `facebook/react` CHANGELOG
