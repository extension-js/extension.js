# Messaging

Every line Extension.js prints follows one grammar, and every machine result uses one envelope.
Humans read the pretty output, agents read the JSON, and neither has to guess.

If you are writing or reviewing a message, this page is the whole rulebook. `pnpm check:messaging`
enforces the parts a script can check, and the CLI test suite enforces the rest.

## Line grammar

Every user-facing line is a prefix followed by one sentence, one concern per line.

| Channel | Prefix | Color | Use |
| --- | --- | --- | --- |
| info | `⏵⏵⏵` | gray | progress and state |
| success | `⏵⏵⏵` | green | a thing finished |
| warn | `⏵⏵⏵` | bright yellow | proceeding, but you should know |
| error | `⏵⏵⏵` | red | stopped, or a result is wrong |
| debug | `···` | dim gray | maintainer internals, `--debug` only |

All five channels occupy the same three columns, so output stays aligned no matter what
happened. The color carries the severity.

`ERROR`, `✖✖✖`, and a bare `⚠` are not prefixes. The rule is positional: a retired glyph is
only a violation at the head of a rendered line, so bundler output quoted inside a
compilation error body can never trip it.

## Copy rules

1. Imperative mood, present tense. "Start the dev server", not "Starts" or "Starting".
2. One sentence per line, ending with a period. Continuation detail goes on its own line.
3. Never name an internal step the user did not ask for. Writing a lockfile or scanning a
   folder is debug, not info.
4. An error states what stopped, then what to do. Never only the first.
5. The brand is `Extension.js` in prose, always. The lowercase forms are for identifiers only:
   cache directories, config paths, bundler tap names, resource queries.
6. The artifact is an `Extension` on Chromium and Safari, an `Add-on` on Gecko. Edge ships
   extensions through a store called Add-ons; the artifact is still an Extension.
7. The ellipsis is `…` (U+2026), never three periods.

## Command descriptions

A command description is one imperative sentence, and it lives in exactly one place: the
command table in `programs/extension/helpers/messages.ts`. Both the `--help` screen and
commander read from it, so the two can never disagree.

The voice rule is a curated list of verbs, not a spelling heuristic. A description has to start
with a verb that is already on the list, and adding a command means adding its verb on purpose.
A suffix rule would be the wrong gate in both directions: `Process`, `Address`, and `Express`
are imperative and end in `-s`, while a noun phrase like "Configuration of the dev server" ends
in neither `-s` nor `-ing` and is still wrong. The suffix heuristic runs against the verb list
itself instead, so it can never block legitimate copy. It exists to stop one specific move:
widening the list with `Creates` to make a failing description pass.

## Debug output

Debug is enabled by `--debug` on any command, or by `EXTENSION_DEBUG=1`.

Debug **adds** lines. It never rewrites a line you would have seen anyway, and it never changes
a prefix. Anything printed without `--debug` is printed identically with it.

Debug lines are greppable, not prose:

```
··· locales  include manifest=true root=false default_locale=none
··· json     deps=0 features=2 critical=1
··· manifest overrides keys=12 devCssStubs=0
```

The older `--author`, `--author-mode`, and `EXTENSION_AUTHOR_MODE` names still work as hidden
aliases and accept any truthy value. They are deprecated; use `--debug`.

## The identity card

A top-level command prints one card before its first work line:

```
 🧩 Extension.js 4.0.16
    Browser        Chromium 141
    Extension      out-probe 1.0.0
    Extension ID   aicjcgkbnbnjnnckchpjcjjcdnpjjhga
    Profile        /work/out-probe/dist/extension-js/profiles/chromium-profile
    Run ID         ms250dnw-hkhe4xpd · PID 46476
```

Rows are omitted when the value is unknown. There is no `n/a`. The launched
browser's profile directory is session identity, so it renders as the
`Profile` row on the paths that know it. A launch that cannot show the card,
such as the deduped preview leg of `start`, keeps the standalone debug profile
line instead.

**The extension ID and the run ID are never abbreviated.** People paste the extension ID
straight into `chrome://extensions`, and a truncated value sends them hunting for the rest.
Machine consumers never read this line: session state lives in `ready.json` and
`events.ndjson` under `dist/extension-js/<browser>/`, and those are the interfaces to parse.

Fallback paths render the same card with fewer rows, never a different layout.

## Machine output

`--output json` prints exactly one JSON document on stdout:

```jsonc
{
  "schema": 1,
  "ok": false,
  "command": "dev",
  "status": "compile-failed",
  "value": null,
  "error": {"code": "E_FIRST_COMPILE", "message": "…"},
  "hint": "…",
  "warnings": []
}
```

What is stable and what is not:

- `schema` is the version of this envelope. It only changes when a field changes meaning.
- `ok` and `status` are the contract. Branch on these.
- `error.code` is stable and greppable. Codes match `E_[A-Z0-9_]+`.
- `error.message` and `hint` are free copy. They can change in any release. **Do not parse
  them, and do not match on the pretty output either.** If you need a signal that is not in
  `ok`, `status`, or `error.code`, open an issue and it will be added to the envelope.
- `value` carries the payload on success, `null` otherwise.

`--output` is the one name for this flag. `--format` and `--wait-format` are deprecated aliases
of it. `logs` keeps `--log-format` for record encoding, which is a different concern: it says
how each streamed record is written, while `--output` governs the single terminating result.

The schema, golden envelopes, and the full error-code table (`codes.json`, with the mapping
from the legacy `ready.json` codes, bridge error names, and doctor check ids) live under
`programs/extension/__spec__/contract/`. Copy them if you are building a tool on top of the
CLI. They are also what the CLI's own tests validate against, so they cannot go stale. Codes
may be added over time, but an existing code is never renamed or removed within a schema.

`--output json` is arriving command by command. The envelope shape above is the target for all
of them, and new code follows it.

## Where the copy lives

Message strings live in a `messages.ts` beside the code that prints them. The shared primitives
(`prefix()`, `fmt`, `card()`, `artifactNoun()`, the envelope, and the error-code table) live in
a `messaging.ts`.

That file is duplicated, on purpose, into each program that needs it:

```
programs/develop/lib/messaging.ts       (canonical)
programs/extension/helpers/messaging.ts
programs/create/lib/messaging.ts
programs/install/lib/messaging.ts
```

There is no shared package. `create` and `install` are small enough that depending on the
develop engine for a sixty-line helper would drag the entire bundler graph behind it, and the
browser runner is deliberately extractable as a standalone bundle. A test asserts the four
copies are byte-identical and points at the canonical when they are not. Edit the canonical,
then copy it over the others.

## Checking your work

```sh
pnpm check:messaging   # prefixes, brand spelling, ellipsis, command voice
pnpm check:prose       # no em dashes anywhere
pnpm test:cli          # the command table, the help screen, and the JSON contract
```

`pnpm check:messaging` prints the offending `file:line`, the rule it broke, and the fix. It
reads string literals rather than raw file text, so a spread, a regex, or an identifier can
never trip a copy rule.
