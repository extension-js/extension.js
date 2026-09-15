# Security assurance case

This document states what users can expect from Extension.js in terms of security, and argues why those expectations hold.
Report vulnerabilities as described in [SECURITY.md](../.github/SECURITY.md).

## Security requirements

### What you can expect

- The dev server and the control bridge bind to `127.0.0.1` unless you set `--host` or `host` in `extension.config.js`.
- The control bridge accepts commands only when you pass `--allow-control`, or `--allow-eval`, which implies it.
- Remote code evaluation through the bridge works only with `--allow-eval` and a matching per-session token.
- The session token is 256 random bits, written with mode 0600, so on macOS and Linux only your user can read it.
- Built-in templates are downloaded over HTTPS, and archive entries cannot write outside the new project folder. A template URL you pass yourself is fetched with the scheme you give it.
- Package managers are started through cross-spawn with argument arrays and no shell option.
- Automatic dependency installs skip lifecycle scripts unless `EXTENSION_ALLOW_INSTALL_SCRIPTS=true`.
- Telemetry sends no source code, file paths, URLs or error text, and is off in unattended CI. `EXTENSION_TELEMETRY_DISABLED=1` turns it off everywhere. See [TELEMETRY.md](TELEMETRY.md).
- TLS certificate verification is never turned off.
- Published packages carry signed provenance. See [VERIFYING_RELEASES.md](VERIFYING_RELEASES.md).

### What you cannot expect

- Extension.js is not a sandbox. Building or running a project executes that project's code and build configuration with your user's permissions. `extension create --install` and your own package manager runs execute dependency install scripts. Treat an untrusted project like untrusted code.
- An extension loaded in a development browser has every permission its manifest requests, plus dev-only permissions. Optional permissions or hosts the dev build needs are granted at install.
- Development builds add `ws://` and `http://` sources for loopback, and for a non-loopback `--host` or `--public-host`, to the extension pages `connect-src`. Do not ship a development build.
- With `--host 0.0.0.0` the dev server is reachable from your network.
- With `--allow-control`, any local process that can reach the port and read the session instance id from `ready.json` can reload the extension, open its pages and read or write its storage.
- Log consumers need no eval token. Any local process that can reach the port and read the session instance id can read the extension's console output.
- Managed browser installs run `playwright@latest` and `@puppeteer/browsers@latest`, so those tools are not pinned.
- Extension.js does not review the security of your extension code.

## Threat model

Assets:

- the developer's machine and files
- the extension source and build output
- the published npm packages
- the developer's store and publish credentials

Attackers considered:

- a malicious website visited in the development browser
- another user or device on the same network
- a compromised or malicious template archive
- a compromised dependency
- a local process run by a different user on the same machine
- an attacker who tries to tamper with a release between the build and the user

Out of scope:

- malware already running as the developer's own user
- a malicious project the developer chooses to build

## Trust boundaries

1. Between the CLI and the network: template downloads, browser downloads, npm and telemetry use HTTPS with certificate verification by default. A template URL or telemetry host you override keeps the scheme you give it.
2. Between the dev server and other processes: the loopback bind address, the session instance id, opt-in control and the eval token.
3. Between the development browser and web content: Extension.js injects nothing into a web page's own scripts. Content scripts get a relay that reaches the dev server only through the extension service worker.
4. Between the project folder and the rest of the file system: archive extraction refuses entries outside the project folder, and static asset output names are hashed so they cannot escape the output folder.
5. Between the source repository and the published packages: the release workflow on GitHub-hosted runners, OIDC publishing and Sigstore provenance.

## Secure design principles

- Fail-safe defaults: loopback bind, control off, eval off, telemetry off in unattended CI.
- Complete mediation: the session token is checked when a controller connects, and every eval request is refused unless that check passed.
- Least privilege: workflow tokens default to read-only, and npm publishing uses short-lived OIDC credentials.
- Economy of mechanism: one broker handles all bridge roles, and each program starts package managers through one cross-spawn helper.
- Open design: the wire contracts are public and documented.
- Separation of privilege: control and eval are separate grants, and log reading needs neither.
- Psychological acceptability: the safe defaults need no configuration, and the unsafe options have explicit flag names.

## Common weaknesses countered

| Weakness | Countermeasure |
| --- | --- |
| OS command injection (CWE-78) | cross-spawn with argument arrays and no shell option. On Windows cross-spawn escapes each argument for the cmd shim. |
| Path traversal (CWE-22) | zip-slip guard on template archives, hashed static asset output names |
| Missing authentication for a critical function (CWE-306) | eval requires `--allow-eval` and the session token |
| Insecure randomness (CWE-338) | the eval token, instance id and telemetry id come from `node:crypto`. `Math.random` is used only for ids that grant nothing. |
| Improper certificate validation (CWE-295) | Node.js defaults, no overrides |
| Exposure of sensitive information (CWE-200) | telemetry allowlist, error codes checked against the `E_` code pattern |
| Hard-coded credentials (CWE-798) | no secrets in the repository other than the public PostHog ingestion key, secret scanning and push protection enabled |
| Use of vulnerable components (CWE-1395) | Dependabot, `pnpm.overrides` pins, CodeQL and Scorecard |
| Unverified downloaded code (CWE-494) | npm integrity hashes and signed provenance for packages. Managed browser installs are the exception, see above. |

## Assurance evidence

- CodeQL on every pull request, every push to `main` and weekly.
- OpenSSF Scorecard on every push to `main` and weekly.
- Unit, integration and property tests on every pull request, including specs for the bridge eval token gate (`programs/develop/dev-server/control-bridge/__spec__/broker-act.spec.ts`).
- The `main` ruleset requires a pull request and the `CI passed` check, and blocks force pushes.
