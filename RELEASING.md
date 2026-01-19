# Releasing

This repo uses a GitHub Actions release workflow to publish the public packages.

## Channels

- Stable: npm dist-tag `latest` (GitHub environment: `stable`)
- Next: published on every merge to `main` with dist-tag `next` (GitHub environment: `next`)

## Scope (public packages)

- `programs/cli` → package: `extension`
- `programs/create` → package: `extension-create`
- `programs/develop` → package: `extension-develop`

All other packages are private and not published.

## Workflow

### 1) Publish workflow (manual)

Use the `Release – Publish` workflow at `.github/workflows/publish-release.yml`.

- Trigger: `workflow_dispatch` with inputs:
  - `channel`: `next` or `stable`
  - `version`: explicit semver (e.g. `3.0.0-next.17` or `3.0.0`)
- CI validates inputs, builds, and runs tests.
- Versions are set for:
  - `programs/cli/package.json`
  - `programs/develop/package.json`
  - `programs/create/package.json`
- CI tags the release as `v<version>`.
- CI publishes `extension`, `extension-develop`, and `extension-create` to npm
  using the selected dist-tag (`next` or `latest`).
- A GitHub Deployment is created for the selected environment.

## Notes

- npm tokens: use automation tokens in `NPM_TOKEN` secret.
- `next` releases must use a pre-release semver (validated in CI).
- `stable` releases must use a clean semver (validated in CI).

## Optional hardening implemented

- `publishConfig.tag: "latest"` explicitly set in public packages
  (`extension`, `extension-develop`, `extension-create`).
- Input validation for channel/version in the release workflow.

## Environments

- `stable`: stable releases (`latest`)
- `next`: next releases (`next`)

Configure under Settings → Environments. They can be identical or protected with required reviewers.

## References

- React repo practices: `facebook/react`
- Changelog style inspiration: `facebook/react` CHANGELOG
