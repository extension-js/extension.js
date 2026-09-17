# Security Policy

## Supported versions

Security fixes ship in the latest published release of the current major version, 4.x.
Older versions do not receive backports.
Upgrade with `npm install extension@latest`.

## Reporting a vulnerability

Please do not file public issues for security problems.

Use GitHub private vulnerability reporting:

1. Open the [Security tab](https://github.com/extension-js/extension.js/security/advisories) of this repository.
2. Click **Report a vulnerability**.
3. Describe the problem with reproduction steps or a proof of concept.

## How we respond

1. We acknowledge the report within 72 hours.
2. We send a first assessment within 14 days. It says whether we accept the report and how severe we think it is.
3. We develop the fix in a private security advisory or a temporary private fork.
4. We publish a release with the fix.
5. We publish the GitHub security advisory and request a CVE through GitHub.
6. We credit the reporter by name in the advisory and in the release notes, unless the reporter asks to stay anonymous.

We aim to release a fix within 60 days of the report.
We keep the reporter informed at each step.

## What to expect from Extension.js

The security guarantees and limits of Extension.js are described in [docs/ASSURANCE_CASE.md](../docs/ASSURANCE_CASE.md).
The trust boundaries section of that document also describes the deploy key that lets the release workflow write its two release commits to `main`, and how that key is rotated.

## Verifying a release

How to check that a package or release tarball was built by this repository is described in [docs/VERIFYING_RELEASES.md](../docs/VERIFYING_RELEASES.md).
