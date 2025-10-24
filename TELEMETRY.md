# Telemetry

Extension.js collects anonymous, privacy-friendly telemetry to help guiding the project development. No personal or sensitive data is ever collected.

- Minimal by design
- Used to guide product improvements
- Public, live dashboard (aggregate-only): https://us.posthog.com/shared/8E-cwAmEUCyxpSB6yePkc5HRN1SgLg

## What is collected

From the CLI and build steps only (never your source code):

- CLI lifecycle: `cli_boot`, `cli_command_start`, `cli_command_finish`, `cli_vendor_start`, `cli_vendor_finish`, `cli_error`
- Manifest statistics (privacy-safe counts): `manifest_summary`
- Build metrics: `cli_build_summary` (total assets, bytes, largest asset bytes, warnings/errors counts)
- Common properties: `app`, `version`, `os`, `arch`, `node`, `is_ci`, `schema_version`

Never collected: file paths, URLs, repo names, env variables, or any PII.

## Opting out

Telemetry is opt-out via CLI flag only:

```bash
# Disable for a single run
extension dev --no-telemetry
```

Telemetry is enabled by default, including CI environments.

## Questions or concerns?

Open an issue: https://github.com/extensionjs/extension/issues
