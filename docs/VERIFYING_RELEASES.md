# Verifying releases

Every Extension.js release is signed with [Sigstore](https://www.sigstore.dev).
Signing is keyless.
Sigstore's Fulcio issues a short-lived certificate to the GitHub Actions workflow that builds the release, and the signature is recorded in the Rekor transparency log.
No long-lived private signing key exists, so none is stored on npm, GitHub or any other distribution site.
The public trust roots are Sigstore's, and the tools below fetch them for you.

## npm packages

Each of `extension`, `extension-create`, `extension-develop` and `extension-install` is published with npm provenance.

Check the packages installed in a project:

```sh
npm audit signatures
```

The output must report verified registry signatures and verified attestations for these packages.

See the attestation for one version:

```sh
npm view extension@4.1.18 dist.attestations
```

The npm package page also shows a Provenance section that links to the exact workflow run and commit.

## GitHub release tarballs

Each GitHub release attaches the four package tarballs and a signed SLSA provenance file.
The release tarballs have the same bytes as the npm packages.
The release workflow checks them against the registry integrity hashes before it uploads them.
Download a tarball and the provenance file from the [release page](https://github.com/extension-js/extension.js/releases), then use the command that matches the provenance file on that release.

### Releases with `provenance.intoto.jsonl`

These are signed by the `release-attest.yml` workflow with GitHub's attestation action.
Run, with the [GitHub CLI](https://cli.github.com):

```sh
gh attestation verify extension-X.Y.Z.tgz \
  --repo extension-js/extension.js \
  --bundle provenance.intoto.jsonl \
  --signer-workflow extension-js/extension.js/.github/workflows/release-attest.yml
```

Without `--bundle`, the command fetches the same attestation from GitHub.

### Releases with `multiple.intoto.jsonl`

These are signed by the SLSA GitHub generator.
Install [slsa-verifier](https://github.com/slsa-framework/slsa-verifier), then run:

```sh
slsa-verifier verify-artifact extension-X.Y.Z.tgz \
  --provenance-path multiple.intoto.jsonl \
  --source-uri github.com/extension-js/extension.js
```

The command must print `PASSED`.
Use `--source-uri` and not `--source-tag`: the provenance records `main` as its source ref, because the attest workflow does not run on the tag.
