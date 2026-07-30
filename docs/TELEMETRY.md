# Telemetry

Extension.js collects a tiny amount of anonymous telemetry to understand which commands are used and which fail. No source code, file paths, URLs, or project content is ever collected.

- Two events total: `command_executed` and `command_failed`
- Three properties: `command`, `success`, `version`
- Opt-out, with notice on first run
- Sampled and capped to stay well inside the PostHog free tier

## What is collected

Per CLI run, at most one of:

| event              | sampled                           | properties                     |
| ------------------ | --------------------------------- | ------------------------------ |
| `command_executed` | 20% (configurable, see below)     | `command`, `success: true`, `version` |
| `command_failed`   | 100% (failures are always tracked)| `command`, `success: false`, `version` |

Common context attached to every event: `os` (`darwin`/`linux`/`win32`), `arch`, `node_major`, `is_ci`. Nothing else.

## Explicitly never collected

- Source code, manifest contents, HTML output, or `package.json` contents
- Repo names, git remotes, branch names, commit SHAs, preview URLs
- Dependency lists, permission lists, or freeform project identifiers
- Environment variable values, filesystem paths, or machine-local URLs
- Stack traces, error messages, or free-text error names
- IP addresses (`$ip` is explicitly set to `null` on every payload)

## Volume controls

Three independent controls, all combined:

- **Sampling**, `command_executed` is sampled at 20% by default. Override via `EXTENSION_TELEMETRY_SAMPLE_RATE` (0.0 – 1.0). Failures are never sampled.
- **Per-run cap**, at most **3 events** per CLI process. Override via `EXTENSION_TELEMETRY_MAX_EVENTS`.
- **Debounce**, duplicate `(event, command, success)` tuples within 60s are dropped. Override via `EXTENSION_TELEMETRY_DEBOUNCE_MS`.

All three together mean a normal day of CLI usage sits comfortably under the PostHog free tier (1M events / month).

## Opting out

Three ways, in precedence order:

```bash
# 1. Environment variable (wins over everything else)
EXTENSION_TELEMETRY_DISABLED=1 extension dev   # Next.js-style, preferred
EXTENSION_TELEMETRY=0 extension dev            # back-compat, also honored

# 2. Per-run flag
extension dev --no-telemetry

# 3. Persistent consent file
extension telemetry disable
extension telemetry enable
extension telemetry             # no arg = show status
extension telemetry status
```

The consent file lives at `$XDG_CONFIG_HOME/extensionjs/telemetry/consent` (or the platform equivalent) and is the only piece of telemetry state persisted on disk besides the anonymous install id and a local audit log of events actually sent.

## Default behavior

Telemetry is **opt-out**. On the first run where none of the overrides above apply, the CLI prints a one-line notice explaining how to disable it and records an `enabled` consent marker so the notice does not repeat.

**Unattended CI is off by default.** When a CI marker (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `BUILDKITE`, `CIRCLECI`, `TRAVIS`) is set **and stdout is not a terminal**, telemetry does not report, because the first-run notice cannot be shown to anyone and a pipeline cannot agree to be measured. A devcontainer, Codespace or agent sandbox sets a CI marker too, but there is a person at a terminal, so those keep reporting and can opt out the normal ways. A stored consent file still wins. To turn it on for a pipeline, set `EXTENSION_TELEMETRY=1`.

## Local audit log

Every event the CLI considers sending (whether or not it actually ships) is appended to `events.jsonl` next to the consent file. Inspect it any time. Delete it freely.

## Questions or concerns?

Open an issue: https://github.com/extensionjs/extension/issues
