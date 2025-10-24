# Releasing

This repo uses Changesets + GitHub Actions to publish only the public packages.

## Channels

- Stable: npm dist-tag `latest` (GitHub environment: `stable`)
- Next: published on every merge to `main` with dist-tag `next` (GitHub environment: `next`)
- RC: optional (manual) via Changesets pre mode

## Scope (public packages)

- `programs/cli` → package: `extension`
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
- Action: CI versions in snapshot mode and publishes `extension` and `extension-develop` to npm with tag `next`.
- A GitHub Deployment is created in environment `next` with published versions annotated and npm info (tarball URL, gitHead, dist-tags).

### 3) Stable releases

- Trigger: merge to `main`
- CI runs `changesets/action` which versions and publishes only the three public packages to `latest`.
- A GitHub Release is created and the aggregated cross‑package changelog is appended to its body.
- A GitHub Deployment is created in environment `stable` with versions annotated and npm info (tarball URL, gitHead, dist-tags).

### 3.1) Stable via tags (CI‑only)

- Tag pattern: `v*.*.*`
- Guard: the tag workflow only runs when the pusher is `github-actions[bot]` (i.e., tags created by Changesets CI), preventing manual stable updates.

### 3.2) Dist‑tag verification

- After publish, CI verifies `latest` points to the just‑published versions for all public packages.

### 4) RCs (optional)

- Start pre mode:

```
pnpm changeset pre enter rc
```

- Version and publish to `rc`:

```
pnpm changeset version
pnpm -r --filter ./programs/cli --filter ./programs/develop \
  publish --tag rc --access public --provenance
```

- Exit pre mode:

```
pnpm changeset pre exit
```

## Notes

- npm tokens: use automation tokens in `NPM_TOKEN` secret.
- Release notes: GitHub Releases aggregate changesets; we also append an aggregated, cross‑package changelog.
- Next channel uses Changesets snapshot pre‑releases with preid `next` and always publishes to dist‑tag `next`, so `npm i extension` or `extension@latest` never installs `next` by accident.

## Optional hardening implemented

- `publishConfig.tag: "latest"` explicitly set in public packages (`extension`, `extension-develop`).
- Tag workflow gated to CI bot.
- Dist‑tag verification steps in both next and stable workflows.

## Environments

- `stable`: stable releases (`latest`)
- `next`: next releases (`next`)

Configure under Settings → Environments. They can be identical or protected with required reviewers.

## References

- React repo practices: `facebook/react`
- Changelog style inspiration: `facebook/react` CHANGELOG
