# Telemetry

Extension.js collects a tiny amount of anonymous telemetry to understand which commands are used and which fail. No source code, file paths, URLs, or project content is ever collected.

- Two events total: `command_executed` and `command_failed`
- Three properties on every event: `command`, `success`, `version`
- Opt-out, with notice on first run
- Sampled and capped to stay well inside the PostHog free tier
- Every event carries `$process_person_profile: false`, which asks the analytics service not to build a person profile for the anonymous ID

## What is collected

Per CLI run, at most one of these, except for a watch session, which is explained below:

| event              | sampled                           | properties                     |
| ------------------ | --------------------------------- | ------------------------------ |
| `command_executed` | 20% (configurable, see below). `create` and session rows are never sampled | `command`, `success: true`, `version` |
| `command_failed`   | 100% (failures are always tracked)| `command`, `success: false`, `version`, `code`, `exit_code`, and on `E_INTERNAL` `error_class`, `error_step` |

Common context attached to every event: `os` (`darwin`/`linux`/`win32`), `arch`, `node_major`, `is_ci`, `is_source_build`, `package_manager`, and `app`, which is always the word `extension`. Nothing else.

`package_manager` is the package manager that ran the command: `npm`, `pnpm`, `yarn`, `bun` or `unknown`. It is the first word of the `npm_config_user_agent` variable a package manager sets for the scripts and binaries it runs, checked against those four names. The version and the rest of that variable are never sent. A run that no package manager started, such as a globally installed `extension` called on its own, reports `unknown`, and so does any other name.

A failure adds two more properties so a failure count can be read as a cause rather than a number:

| property    | value                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| `code`      | one name from the CLI's fixed error catalog, for example `E_MANIFEST_NOT_FOUND` |
| `exit_code` | the process exit code, an integer from 0 to 255                            |

`code` is checked against the catalog before it is sent. A Node errno, a message, or any
value that is not a catalog name is dropped and the event is sent with no `code` at all, so
no error text ever travels.

A failure with `code` `E_INTERNAL` is one the CLI did not expect, so the code alone cannot say
what broke. That row adds two more properties, each a word from a fixed list:

| property      | value                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| `error_class` | a Node system code from a fixed list, such as `ENOENT`, `EPERM` or `ERR_MODULE_NOT_FOUND`, when the error has one of them, else a built-in class: `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError` or `AggregateError`, else `other` |
| `error_step`  | where it was thrown: `action` (the command itself), `engine_load` (loading the build engine), `engine` (the build engine running) or `scaffold` (`create` copying a template), or absent |

A system code is sent only when it is in Node's own table of codes. Any other class, including
the CLI's own and every dependency's, is sent as `other`. The step is a word the CLI chose, never
a function name, so the message, the stack, the path and the user name stay on the machine.

`command` is always one of the CLI's registered command names. A word that is not one, such as
a typo or a project folder, is reported as `unknown` with `code` `E_UNKNOWN_COMMAND`, and the
word itself is never sent.

A Node.js, Bun or Deno version below the supported floor stops the CLI before it loads. That
run reports one `command_failed` with `code` `E_NODE_VERSION`, and only on a machine that
already showed the first-run notice, because the notice is printed by the part that never loads.

### Long-running commands

`dev`, `start` and `preview` do not end on their own, they watch until you stop them. Counting
them only at exit would mean a session that ends with Ctrl-C is never counted at all, which is
what used to happen. So these three report once at the handoff to the watch runtime, which is
before the first compile: a `dev` whose first compile fails has already contributed its started
row, and the failure then arrives as its own `command_failed` row.

| property  | value                                                              |
| --------- | ------------------------------------------------------------------ |
| `session` | `started`, present only on `command_executed` for these commands   |
| `session` | `ready`, present only on a second `command_executed` for `dev`     |

A started row alone cannot tell a `dev` that worked from one that hung before the browser
opened. So `dev` reports once more, at most once per run, when the session is ready to use:

- with a launched browser, when the browser launch finished and the browser accepted the
  extension. A session the browser refused reports ready only if a later compile gets the
  extension loaded. `--no-open` changes nothing here: the browser still launches and only the
  extension tab is skipped, so the row is sent at the same moment.
- with Safari, when the first packaging pass finished: the app was converted and built, or
  reused when nothing changed, then opened and checked for registration with Safari. With
  `--no-open` the pass ends once the app is built. The row does not say the extension is
  enabled in Safari. It is sent whether or not that switch was turned on.
- with `--no-browser`, when the first compile finished without errors, since there is no
  browser to wait for.

The ready row carries the same properties as the started row and nothing more: no timing, no
browser name, no project detail. `start` and `preview` do not send it.

Three consequences worth stating plainly:

- **A watch session can produce two rows, and a `dev` session three**: one `command_executed`
  with `session: started` at the handoff, for `dev` one `command_executed` with
  `session: ready`, and one `command_failed` later if it breaks, first compile included. That
  is deliberate. It gives the failure count a denominator counted the same way.
- **Session rows are never sampled**, the ready row included. Sampling the denominator while
  failures ship in full would overstate the failure rate by five times, which is the reporting
  error this exists to fix, and a sampled ready row could not be compared with a started row
  that is not.
- **Stopping a watch session with Ctrl-C is not a failure** and is not reported as one. A short
  command killed by a signal does report a failure, with `code` `E_INTERRUPTED`.

Nothing extra is collected here. `session` is a single word, `started` or `ready`, attached to
an event that was already being sent.

`dev`, `start`, `preview` and `build` add one property when the run targets a single browser, whether it came from `--browser`, from `extension.config.js` or from the default:

| property  | value                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| `browser` | `chrome`, `edge`, `firefox`, `safari`, `chromium-based` or `gecko-based`, or absent |

Those six words are the only values `browser` can take. `chromium` and a named Chromium fork (Brave, Opera, Vivaldi, Yandex) are sent as `chromium-based`. A named Gecko fork (Waterfox, LibreWolf, Zen, Floorp) and `firefox-based` are sent as `gecko-based`. A run with `--chromium-binary` is sent as `chromium-based` and a run with `--gecko-binary` or `--firefox-binary` as `gecko-based`, whatever name was typed, so a binary path, a product name and a version are never sent. The property is absent when a run targets several browsers (`--browser chrome,firefox` or `all`), for `webkit-based`, `chromium-emulator` or any value outside the list, and on a failure that happened before the command picked its browser.

When a run offers to download a managed browser, the command's event carries the outcome so
the offer can be told apart from a dead end:

| property                  | value                                              |
| ------------------------- | -------------------------------------------------- |
| `browser_install`         | `offered`, `accepted`, `declined` or `failed`      |
| `browser_install_browser` | the managed browser name, for example `chrome`     |
| `browser_install_seconds` | whole seconds the download took, when one ran      |

`extension install` adds one property, so its failures can be counted by browser:

| property         | value                                                        |
| ---------------- | ------------------------------------------------------------ |
| `install_target` | `chrome`, `chromium`, `edge`, `firefox` or `all`, or absent |

A bare `extension install` sends `chromium`, the browser it installs. The property is absent when several browsers are named (`extension install chrome firefox`), for a family alias such as `chromium-based`, and for any name outside the list, so a typed value is never sent.

The `create` command adds four properties, so a broken advertised starter shows up in its failure counts and a slow or failed dependency install can be told apart from a project nobody ran:

| property   | value                                                                 |
| ---------- | --------------------------------------------------------------------- |
| `template` | the starter name as listed by `extension create --help`, or absent. With no `--template`, the default starter's name, `typescript` |
| `source`   | `cli`, or `templates` when the docs template gallery started the create   |
| `deps_install` | `skipped`, `installed` or `failed`, for the dependency install `--install` runs |
| `deps_install_seconds` | whole seconds the dependency install took, when one ran |

`template` is checked against the published starter list before it is sent. A create with no `--template` sends the default starter's name, the same value an explicit `--template typescript` sends. A GitHub URL, a local folder path or any other value that is not an advertised name is dropped rather than trimmed, so a private repository or a directory name never leaves the machine. `source` is checked the same way against the two surfaces above, and any other value is sent as `cli`.

`is_source_build` is a boolean and nothing more. It is `false` when the CLI was resolved from a package manager directory, which is what an ordinary install looks like, and `true` when it was resolved from a checkout of this repository. It exists so a run of the framework's own development can be told apart from a run by somebody using it. No path, no directory name and no hash of either is collected or transmitted; only the boolean leaves the machine.

## Explicitly never collected

- Source code, manifest contents, HTML output, or `package.json` contents
- Repo names, git remotes, branch names, commit SHAs, preview URLs
- Dependency lists, permission lists, or freeform project identifiers
- Environment variable values, filesystem paths, or machine-local URLs
- Stack traces, error messages, or free-text error names
- IP addresses. The CLI sends `$ip: null` and `$geoip_disable: true` on every event, which ask the analytics service not to keep the request address or derive a location from it.

## How long events are kept

Events are kept for 12 months. The analytics project deletes older events in monthly batches, a whole month at a time, so an event can stay up to about 13 months before it is removed. The local audit log on your machine is yours: delete it at any time.

## Releases before 4.0

The 3.x line sent a different schema, published in this file until 2026-04-17: lifecycle events (`cli_boot`, `cli_command_start`, `cli_command_finish`, `cli_vendor_start`, `cli_vendor_finish`, `cli_shutdown`, `cli_telemetry_consent`), `manifest_summary` (permission and content script counts), `project_profile` (framework family and package manager), `workflow_profile` (a usage cohort) and `cli_build_summary` (asset counts and bytes). Counts, booleans and names from fixed lists, never a path, a URL or a project name. Installs still on 3.x keep sending those events. From 4.0 on, the CLI sends only the two events above.

## Volume controls

Three independent controls, all combined:

- **Sampling**, `command_executed` is sampled at 20% by default. Override via `EXTENSION_TELEMETRY_SAMPLE_RATE` (0.0 - 1.0). Failures are never sampled, and neither are `create` rows, the `session: started` rows for `dev`, `start` and `preview` or the `session: ready` row for `dev`. Every `create` is sent, success or failure.
- **Per-run cap**, at most **3 events** per CLI process. Override via `EXTENSION_TELEMETRY_MAX_EVENTS`.
- **Debounce**, duplicate `(event, command, success, session)` tuples within 60s are dropped. Override via `EXTENSION_TELEMETRY_DEBOUNCE_MS`.

All three together mean a normal day of CLI usage sits comfortably under the PostHog free tier (1M events / month).

## Opting out

Three ways, in precedence order:

```bash
# 1. Environment variable (wins over everything else)
EXTENSION_TELEMETRY_DISABLED=1 extension dev   # Next.js-style, preferred
EXTENSION_TELEMETRY=0 extension dev            # back-compat, also honored
DO_NOT_TRACK=1 extension dev                   # the cross-tool convention

# 2. Per-run flag
extension dev --no-telemetry

# 3. Persistent consent file
extension telemetry disable
extension telemetry enable
extension telemetry             # no arg = show status
extension telemetry status
extension telemetry reset       # delete the anonymous ID, the consent and the audit log
```

`DO_NOT_TRACK` follows the [Console Do Not Track](https://consoledonottrack.com) convention. Any value other than empty, `0` or `false` turns telemetry off, and it wins over `EXTENSION_TELEMETRY=1`. When more than one of the three variables is set, `extension telemetry status` names the first one in the order above.

The run that turns telemetry off reports nothing about itself. `extension telemetry disable`
silences the running process at the moment it records your choice, so the act of opting out is
never the last thing collected from you.

## Status and reset

`extension telemetry status` prints whether telemetry is on, what decided it (the variable by name when one did), the anonymous ID, the consent file path and the audit log path. It reads only: it never creates a folder, an ID or a file. A value that is not stored yet reads `none`. `--output json` carries the same answer as `enabled`, `source`, `variable`, `anonymousId`, `consentFile` and `auditFile`.

`extension telemetry reset` deletes the anonymous ID, the stored consent, the `notice-shown` marker and the local audit log with its `.1` backup, in every folder listed under "Where the files live". The run that resets reports nothing about itself. The next run starts fresh: it creates a new anonymous ID and prints the first-run notice again. A stored opt-out is deleted with the rest, and the command says so. Run `extension telemetry disable` afterward to keep telemetry off.

## Where the files live

The CLI uses the first writable folder of these three: the config home (`$XDG_CONFIG_HOME/extensionjs`, `%APPDATA%\extensionjs` on Windows, or `~/.config/extensionjs`), the cache home (`$XDG_CACHE_HOME/extensionjs`, `%LOCALAPPDATA%\extensionjs\Cache` on Windows, or `~/Library/Caches/extensionjs` on macOS), then `extensionjs` in the system temp folder. The project folder is never used. When none of the three is writable, telemetry is off for that run: nothing is sent and no file is written, and `extension telemetry status` reports `source: storage`.

The consent file lives at `telemetry/consent` inside that folder, for example `$XDG_CONFIG_HOME/extensionjs/telemetry/consent`. The only other telemetry state persisted on disk is the anonymous install id, a `notice-shown` marker recording that the first-run notice was printed, and a local audit log of every event the CLI considered sending (not every row was delivered, see below).

## Default behavior

Telemetry is **opt-out**. On the first run where none of the overrides above apply, the CLI prints a one-line notice explaining how to disable it, records an `enabled` consent marker and records that the notice was shown, so the notice prints once per machine.

**Unattended CI is off by default.** When a CI marker (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `BUILDKITE`, `CIRCLECI`, `TRAVIS`) is set **and stdout is not a terminal**, telemetry does not report, because the first-run notice cannot be shown to anyone and a pipeline cannot agree to be measured. A devcontainer, Codespace or agent sandbox sets a CI marker too, but there is a person at a terminal, so those keep reporting and can opt out the normal ways. To turn it on for a pipeline, set `EXTENSION_TELEMETRY=1`.

A stored `enabled` consent file does **not** override this. That file records that a person agreed at that keyboard once; it cannot tell that apart from a pipeline that later inherited the same home directory, which is the case on self-hosted runners, baked container images and any CI that caches `$HOME`. A stored `disabled` still wins everywhere, because a refusal never needs re-confirming.

A stored `enabled` consent file that sits inside a git worktree is ignored as well. It came with the clone, so it cannot record your agreement. The run falls back to the default, which shows the first-run notice. A stored `disabled` there is still honored.

## Local audit log

Every event the CLI considers sending (whether or not it actually ships) is appended to `events.jsonl` next to the consent file. Inspect it any time. Delete it freely, or run `extension telemetry reset`. `extension telemetry status` prints its path.

## Questions or concerns?

Open an issue: https://github.com/extension-js/extension.js/issues
