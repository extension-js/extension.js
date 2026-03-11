# Telemetry

Extension.js collects anonymous, privacy-friendly telemetry to help guiding the project development. No personal or sensitive data is ever collected.

- Minimal by design
- Used to guide product improvements
- Public, live dashboard (aggregate-only): https://us.posthog.com/shared/8E-cwAmEUCyxpSB6yePkc5HRN1SgLg

## What is collected

From the CLI and build steps only (never your source code):

- CLI lifecycle: `cli_boot`, `cli_command_start`, `cli_command_finish`, `cli_vendor_start`, `cli_vendor_finish`, `cli_error`
- Manifest statistics (privacy-safe counts): `manifest_summary`
- Project profile (privacy-safe, coarse only): `project_profile`
- Workflow cohort (run-level intent model): `workflow_profile`
- Build metrics: `cli_build_summary` (total assets, bytes, largest asset bytes, warnings/errors counts)
- Common properties: `app`, `version`, `os`, `arch`, `node`, `is_ci`, `schema_version`

## Privacy-safe profile data

When available, Extension.js may send coarse project-shape signals that help us understand feature demand without identifying a person, repository, or company:

- Package manager: `npm`, `pnpm`, `yarn`, `bun`, or `unknown`
- Framework family: `react`, `preact`, `vue`, `svelte`, `solid`, `angular`, or `unknown`
- Booleans only for broad ecosystem signals such as `has_typescript`, `is_monorepo`, `has_next_dependency`, `has_turbo_dependency`
- Manifest surface buckets such as `action_popup`, `content_scripts`, `devtools`, `background_only`, or `multi_surface`
- Permission count buckets instead of raw permission lists

Command telemetry may also include coarse workflow flags such as:

- `browser_count` / `is_multi_browser`
- `is_wait_mode`
- `is_no_browser_mode`
- `is_remote_input`
- `zip` / `zip_source` / `artifact_kind`

## Workflow cohorts

To keep investor and product reporting simple, Extension.js also emits a normalized `workflow_profile` event with one cohort field:

- `local_only`: local iteration without strong release or automation signals
- `shipping`: release-oriented behavior such as production commands, artifact output, or multi-browser packaging
- `automation_heavy`: machine-oriented behavior such as wait-mode, no-browser workflows, or machine-readable output

The event also includes:

- `workflow_cohort`
- `has_shipping_intent`
- `has_automation_intent`
- `shipping_signal_count`
- `automation_signal_count`
- `primary_workflow_signal`
- `package_manager`
- `framework_primary`
- `has_next_dependency`
- `has_turbo_dependency`

This model is intentionally coarse. It is designed for aggregate product questions, not for identifying specific users or projects.

Never collected: file paths, URLs, repo names, env variables, or any PII.

## Explicitly never collected

To keep telemetry privacy-safe, Extension.js does not collect:

- Source code, manifest contents, HTML output, or package.json contents
- Repo names, Git remotes, GitHub orgs/users, branch names, commit SHAs, or preview URLs
- Raw dependency lists, raw permission lists, or freeform project identifiers
- Environment variable values, filesystem paths, or machine-local URLs
- IP addresses (`$ip` is explicitly disabled in the telemetry payload)

This telemetry contract applies to Extension.js CLI/build telemetry. It does not describe future hosted product analytics outside this repository.

## Opting out

Telemetry is opt-out via CLI flag only:

```bash
# Disable for a single run
extension dev --no-telemetry
```

Telemetry is enabled by default, including CI environments.

## Questions or concerns?

Open an issue: https://github.com/extensionjs/extension/issues
