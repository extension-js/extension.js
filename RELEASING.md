# Releasing

This repo uses Changesets + GitHub Actions to publish only the public packages.

## Channels

- Stable: npm dist-tag `latest`
- Next: published on every merge to `main` with dist-tag `next`
- RC: optional (manual) via Changesets pre mode

## Scope (public packages)

- `programs/cli` → package: `extension`
- `programs/create` → package: `extension-create`
- `programs/develop` → package: `extension-develop`

All other packages are private and not published.

## Workflow

### 1) Every PR must include a changeset

Run:

```
pnpm changeset
```

Select affected packages and bump type. PR CI fails if missing a changeset.

### 2) Next releases

- Trigger: every merge to `main`
- Action: CI versions in snapshot mode and publishes `extension`, `extension-create`, and `extension-develop` to npm with tag `next`.
- A GitHub Deployment is created in environment `npm-next` with published versions annotated.

### 3) Stable releases

- Trigger: merge to `main`
- CI runs `changesets/action` which versions and publishes only the three public packages to `latest`.
- A GitHub Release is created and the aggregated cross‑package changelog is appended to its body.
- A GitHub Deployment is created in environment `production` with versions annotated.

### 4) RCs (optional)

- Start pre mode:

```
pnpm changeset pre enter rc
```

- Version and publish to `rc`:

```
pnpm changeset version
pnpm -r --filter ./programs/cli --filter ./programs/create --filter ./programs/develop \
  publish --tag rc --access public --provenance
```

- Exit pre mode:

```
pnpm changeset pre exit
```

## Notes

- npm tokens: use automation tokens in `NPM_TOKEN` secret.
- Release notes: GitHub Releases aggregate changesets; we also append an aggregated, cross‑package changelog.

## Environments

- `production`: stable releases (`latest`)
- `npm-next`: next releases (`next`)

Configure under Settings → Environments. They can be identical or protected with required reviewers.

## References

- React repo practices: `facebook/react`
- Changelog style inspiration: `facebook/react` CHANGELOG
