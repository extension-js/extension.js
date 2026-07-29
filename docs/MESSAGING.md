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

## Voice

Every line is one of two classes, and the class decides the mood.

**Status lines** state what happens or happened. Present or past tense, never imperative:
"Recompiling due to file changes…", "Extension ready for development." A status line written
as a command reads like an order to the user, which is the defect class this split retired.

**Instruction lines** are imperative remedies: "Install Chrome, or choose another browser
with `--browser edge`." They appear in error and warning remedies, in help text, and in
command descriptions. One action per sentence.

The rest of the voice rules:

- Second person, active voice. The subject is the thing that acts: "The dev server listens
  on port 3001", not "Port 3001 will be used".
- Say the result, not the mechanism. "Chrome could not load the extension", not "CDP attach
  failed on target". Internals go to debug.
- Sentence case everywhere. Proper nouns only (Chrome, Extension.js, Manifest V3).
  Exceptions: card labels ("Extension ID") and uppercase evidence labels ("PATH", "REASON").
- Tense by channel: progress is present tense with a single trailing `…` allowed. Success is
  stative, marked by the green glyph, with no celebration words. Failure is a plain statement
  followed by an imperative remedy.
- Contractions preferred: "can't" over "cannot".
- Prefer "choose" over "pick" or "select".
- Sentences stay under 25 words, one instruction per sentence.

## Copy rules

1. One sentence per line, ending with a period, on every human channel. Debug key=value
   lines never end with a period. Card rows and evidence rows are data, no periods.
2. No em dashes, no semicolons, no exclamation marks in message prose.
3. Forbidden words: "successfully" (the channel already signals success), "please", "oops"
   and "sorry", and "Invalid" as a sentence opener. Say what would be valid, or open with
   "Can't …" and put the offending value in an evidence row.
4. Emoji are banned everywhere except the identity card's 🧩 head.
5. Every value carries its noun: "port 8080", "Chrome 138.0.7204.49", "512 ms", "PID 41250".
6. Never name an internal step the user did not ask for. Writing a lockfile or scanning a
   folder is debug, not info.
7. The brand is `Extension.js` in prose, always. The lowercase forms are for identifiers
   only: cache directories, config paths, bundler tap names, resource queries.
8. The artifact is an `Extension` on Chromium and Safari, an `Add-on` on Gecko. Edge ships
   extensions through a store called Add-ons, but the artifact is still an Extension.
9. The ellipsis is `…` (U+2026), never three periods.

## One fact once

Every fact has exactly one home per tier:

| Fact class | Home |
| --- | --- |
| Session identity (versions, browser, extension, ID, profile, binary, run) | the card, only |
| Events (compiled, recompiling, exited, port fallback) | flow lines |
| Diagnostics | debug channel, key=value |

Consequences:

- Flow lines never restate a fact the card already shows. The binary path lives in the card,
  never in a pre-card flow line.
- The ready line names no browser. The card's Browser row already did.
- Paths appear in card rows and error evidence only. Card rows collapse the home directory
  to `~` for scanability. Evidence and debug rows never collapse, because they must paste
  back into a shell unchanged.
- Versions appear in the card only, unless the version is the error cause.
- Ports appear only when deviating from the default or when the user must connect.
  Otherwise they are debug.

## Tier ladder

New messages declare their tier before their copy is written.

- Tier 1, default: the card, one compile line per build, the ready line, warnings, and
  errors. Nothing else.
- Tier 2, debug (`--debug` or `EXTENSION_DEBUG=1`): `··· <area> key=value` lines in a
  frozen grep-able format. Debug adds lines, it never rewrites tier 1.
- Tier 3, machine: the JSON envelope, `ready.json`, and `events.ndjson`.

## The boot sequence

The contract for `extension dev` with the default managed browser:

```
⏵⏵⏵ [12:01:33] My Extension compiled in 512 ms.

 🧩 Extension.js 4.0.20
    Browser        Chrome for Testing 138.0.7204.49
    Extension      My Extension 1.0.0
    Extension ID   pjkghmlbdmhkfellgkkcolmnlhwmubhe
    Profile        ~/.extension-js/profiles/chrome
    Run ID         f3a9 · PID 41250

⏵⏵⏵ Extension ready for development. Watching for file changes.
```

A non-default binary (pinned, system fallback, or cached snapshot) grows the card by one
row. No flow line is added:

```
 🧩 Extension.js 4.0.20
    Browser        Chromium 139.0.7259.2 (system, not the managed default)
    Binary         /Applications/Chromium.app/Contents/MacOS/Chromium
    ...
```

The encoded rules:

- The order is compiled, then card, then ready, in both launch modes.
- The compile line keeps its timestamp and never says "successfully". The marked variants
  are the failures: "compiled with warnings in N ms.", "compiled with errors in N ms."
- Exactly one blank line above and below the card. The card prints once per
  (browser, dist) pair.
- The ready line is green, uses `artifactNoun()`, names no browser, and states the watch
  state.
- The provenance parenthetical on the Browser row appears only on deviation.
- Rebuilds reprint only the compile line.
- `build` swaps the Profile and Run ID rows for an Output row and closes with
  "Extension built for production in dist/chrome." A failed build closes with
  "Build failed with N errors."
- Timestamps appear only on recurring lines, which is the compile family.

## Color and glyph

One meaning per color, and meaning never lives only in color (`NO_COLOR` safe, pintor
implements the full NO_COLOR, FORCE_COLOR, and TTY matrix).

| Color | Meaning |
| --- | --- |
| red | failure |
| yellow | warning |
| green | success and ready |
| gray | de-emphasis: timestamps, card values, evidence labels |
| blue | typeable input: commands, flags, env vars |
| brightBlue | the brand word in the card head, nothing else |
| underline | a location: path or URL |
| dim | the debug channel |

Ports and durations are values, not input, so they are never blue. One glyph `⏵⏵⏵` on
human channels, `···` dimmed for debug.

## Error anatomy

A failure has a fixed three-part shape:

```
⏵⏵⏵ Can't find the Chrome binary.
NOT FOUND /Users/dev/.chromium/chrome
Install Chrome, or choose another browser with --browser edge.
```

1. The label line: red glyph, one sentence, what did not happen. Never "Error:", never
   `E_` codes (those live in the envelope).
2. Evidence rows: uppercase gray label, underlined value, one fact per row. The approved
   evidence labels are `PATH`, `REASON`, `NOT FOUND`, `USING`, `CACHED`, `EXPECTED`, `GOT`.
3. The remedy, last: imperative, one action per sentence, typeable text in blue, at most
   three alternatives as `- ` bullets. If the remedy is unknown, say what to report. Never
   pad.

Info lines that carry data reuse the same row grammar with the data-line label set: `URL`,
`GOT`, `SOURCE`, `FLAGS`, `CONFIG`. A new label in either set gets added to this page on
purpose, not invented inline.

Warnings use the same shape in yellow, and a warning prints before the action it concerns.
A warning with no evidence and no remedy is probably an info or debug line.

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

Commander's own parse failures render through the error anatomy too, with suggestions as the
remedy. The raw `error: unknown option` form never reaches the user.

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
aliases and accept any truthy value. They are deprecated, use `--debug` instead.

## The identity card

A top-level command prints one card, in the boot order above:

```
 🧩 Extension.js 4.0.16
    Browser        Chromium 141
    Extension      out-probe 1.0.0
    Extension ID   aicjcgkbnbnjnnckchpjcjjcdnpjjhga
    Profile        ~/.extension-js/profiles/chromium
    Run ID         ms250dnw-hkhe4xpd · PID 46476
```

Rows are omitted when the value is unknown. There is no `n/a`. Row presence follows fact
availability, not call site: `build` and the `--no-browser` modes show an Output row, a
launch shows Profile and Run ID, a non-default binary adds a Binary row. A launch that
cannot show the card, such as the deduped preview leg of `start`, keeps the standalone debug
profile line instead.

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

Human lines route through the sinks in `messaging.ts`: `humanLine()`, `humanWarn()`, and
`humanError()`. When `EXTENSION_OUTPUT` is `json` or `ndjson`, `humanLine()` and `humanWarn()`
go quiet so frames own the stream, while `humanError()` always writes to stderr, because a
launch failure must never disappear just because a machine is listening. Never print a human
line with a raw `console` call.

## Frozen contracts

These shapes are parsed by tools and tests. Copy inside them may change, the shapes may not.

- The schema-1 envelope and its `CODES`. Copy inside `error.message` may change.
- The `ready.json` and `events.ndjson` provenance fields.
- The debug grep format: `···` glyph, 8-character area, key=value pairs.
- Card parse stability: the `🧩 Extension.js` head, the 15-character label column, the
  4-space row indent, empty rows omitted. Adding a row is shape-compatible. The column
  width and the head must not move.
- The four `messaging.ts` copies stay byte-identical (see below).
- `pnpm check:prose` applies to all message strings.
- The current channel-to-stream mapping (see deferred deviations).

## Deferred deviations

Known departures from the target, accepted on purpose. Do not fix them piecemeal.

- Human output does not yet split across stdout and stderr by channel. The harnesses were
  recently migrated onto the current mapping, so re-splitting is churn without payoff for
  now. The mapping itself is frozen above.
- The `logs` command's record printers keep their raw `console.log` calls on purpose: the
  records are the command's payload, chosen by `--log-format`, not human chrome, so the
  machine-mode suppression in the sinks must not apply to them.

## Where the copy lives

Message strings live in a `messages.ts` beside the code that prints them. The shared primitives
(`prefix()`, `fmt`, `card()`, `artifactNoun()`, the human sinks, the envelope, and the
error-code table) live in a `messaging.ts`.

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
pnpm check:messaging   # prefixes, brand, ellipsis, voice, forbidden words,
                       # emoji, semicolons, brightBlue, glued periods
pnpm check:prose       # no em dashes anywhere
pnpm test:cli          # the command table, the help screen, and the JSON contract
pnpm test:dev          # the boot transcripts, byte for byte
```

`pnpm check:messaging` prints the offending `file:line`, the enclosing function, the rule it
broke, and the fix. It reads string literals rather than raw file text, so a spread, a regex,
or an identifier can never trip a copy rule. What a script cannot judge stays review
discipline: the status against instruction voice split, one-fact-once, tier placement, and
noun-with-value.
