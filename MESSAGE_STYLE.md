## Message style guide (CLI + develop runtime)

This document describes the conventions for all human-facing terminal output in
`extension.js` so the CLI and develop runtime feel predictable and consistent.

### 1. Prefixes

- **Normal mode**
  - **Errors**: `ERROR` (red)
  - **Warnings / info / success**: `►►►` (yellow / gray / green)
- **AUTHOR_MODE (`EXTENSION_AUTHOR_MODE === 'true'`)**
  - **Errors**: `ERROR Author says` (bright magenta)
  - **Non-errors**: `►►► Author says` (bright magenta)

When using helpers like `getLoggingPrefix(...)`, they are responsible for
choosing the right colored prefix (including Author Mode). Callers should
generally do:

```ts
;`${getLoggingPrefix('info')} Rest of the message...`
```

### 2. Color roles

- **Red**: errors and fatal conditions.
- **Yellow**: warnings, deprecations, and “might be a problem”.
- **Green**: success / completion states.
- **Gray**: neutral labels, counts, paths, or environment descriptors.
- **Blue**: commands, flags, URLs, and code-like snippets.

Helpers like `fmt.code`, `fmt.label`, and CLI-specific `code()` / `arg()` wrap
these semantics and should be preferred over inlined `colors.*` calls when
formatting commands, flags, and placeholders.

### 3. Author Mode output

Author-only diagnostics (behind `EXTENSION_AUTHOR_MODE`) must:

- Start with a bright magenta prefix:
  - Either via `getLoggingPrefix` (`ERROR Author says` / `►►► Author says`), or
  - Via `colors.brightMagenta('►►► Author says')` for logs that do not use
    `getLoggingPrefix`.
- Keep the rest of the message structure intact (same wording and arguments as
  non-author logs).

This makes Author Mode lines easy to scan visually and simple to grep for
`Author says`.

### 4. System / meta messages

Messages that are about the toolchain itself (telemetry consent, rslib
post-build setup, etc.) should:

- Use a neutral system prefix:
  - `colors.gray('►►► system')` at the start of the line.
- Keep existing `[tag]` markers such as `[extension]` or `[Extension.js setup]`
  after the prefix, unmodified.

### 5. Multi-line messages

For multi-line blocks:

- First line: include the full prefix and a short title.
- Following lines: start at column 0, without an additional prefix, unless they
  are logically separate messages.
- Use blank lines sparingly to separate sections (for example, headings in
  `--help` output).

Example:

```txt
►►► JS: Configs
TSCONFIG .../tsconfig.json
TSROOT   .../src
SWC_TARGETS default
```

### 6. Tone and emphasis

- Prefer sentence case over ALL-CAPS for prose.
- Use color and underline for emphasis; reserve ALL-CAPS for short tokens
  (`ERROR`, `NOT FOUND`) where it significantly improves scannability.
- Emoji are allowed in user-facing notices, but avoid relying on them for
  critical meaning and keep them out of low-level debug / author diagnostics.
