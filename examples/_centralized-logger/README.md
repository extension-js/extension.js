<a href="https://extension.js.org" target="_blank"><img src="https://img.shields.io/badge/Powered%20by%20%7C%20Extension.js-0971fe" alt="Powered by Extension.js" align="right" /></a>

# centralized-logger

> Centralized logger for all extension contexts with a React sidebar UI

centralized-logger is a browser extension template that captures console output from every meaningful MV3 context and displays a unified, searchable stream in the side panel.

Captured contexts

- Background service worker (auto)
- Content scripts (all frames, about:blank)
- Injected page context (via script injection)
- Sidebar (side panel)
- Options page (optional)
- DevTools page (optional)

Transport

- Uses a long-lived `chrome.runtime.connect({ name: 'logger' })` Port per context
- Background acts as the Log Hub (ring buffer, broadcast to subscribers)

UI (sidebar)

- Shadcn/TanStack table with batching + autoscroll guard
- Filters: context, tab, level; debounced full-text search (message/URL)
- Columns: Time, Title, Context (with tab/frame), Source (host/path), Level, Message, Expand
- Sorting and column resizing, layout persisted; reset layout action
- Row selection, copy visible/selected, export JSON/NDJSON
- Expand row shows structured JSON details in Monaco (lazy), falls back to `<pre>`
- Toaster feedback on copy

CLI output (parity)

- Pretty-mode CLI output mirrors the sidebar semantics:
  - Time: gray
  - Context colors (approximate ANSI palette; avoids dark/black):

    | Context    | CLI color        |
    | ---------- | ---------------- |
    | background | green            |
    | content    | magenta          |
    | page       | yellow/bright    |
    | sidebar    | cyan/bright blue |
    | popup      | bright green     |
    | options    | cyan             |
    | devtools   | yellow/bright    |

  - Tab suffix `#<id>` is included only for tabbed contexts (content/page/sidebar/popup/options/devtools). It is omitted for background and manager logs.
  - Incognito logs append ` (incognito)` after the header when available.
  - Message parts are sanitized: null/undefined → `(unknown)`; all-empty → `(none)`.

- Example (pretty):

  ```
  ►►► 2025-09-05T18:16:44.178Z background - extension installed (reason: unknown)
  ►►► 2025-09-05T18:16:44.272Z content#123 https://example.com - console log text
  ```

- Example (JSON):

  ```json
  {
    "timestamp": 1693934204178,
    "level": "info",
    "context": "content",
    "tabId": 123,
    "url": "https://example.com/",
    "messageParts": ["console log text"]
  }
  ```

CLI flags quick reference

- `--logs <off|error|warn|info|debug|trace>`: minimum level
- `--log-context <list|all>`: filter by contexts (e.g. `background,content`)
- `--log-format <pretty|json>`: output format
- `--no-log-timestamps` / `--no-log-color`: disable timestamps or color
- `--log-url <substring|/regex/>` and `--log-tab <id>`: additional filtering

Background enrichment

- Title (via tabs API) and hostname/path where available
- Optional stack capture for background logs (set `chrome.storage.session.logger_capture_stacks = true`)
- Duplicate suppression to avoid noisy repeats

Security/CSP

- Monaco loads from local assets: `public/monaco/vs`, configured via `loader.config({ paths: { vs: '../monaco/vs' } })`

Performance

- Batching UI updates (50ms)
- Autoscroll only when user is at the bottom
- Visible rows capped (default 3000) to keep the table responsive

Extending

- Add popup support by creating a page and invoking `setupLoggerClient('popup')`
- Add custom client logs with
  ```ts
  const port = chrome.runtime.connect({name: 'logger'})
  port.postMessage({
    type: 'log',
    level: 'info',
    messageParts: ['hello'],
    context: 'custom',
    url: location.href
  })
  ```

## Usage (from your extension)

This logger no longer injects its own content/page script. To centralize your extension's logs, import the client from the logger extension and initialize it in each context you want to capture.

1. Import and initialize

```ts
// Anywhere in your extension (e.g., content script, background, popup)
// Replace <LOGGER_EXTENSION_ID> with the installed centralized-logger's ID.
import {setupLoggerClient} from 'chrome-extension://<LOGGER_EXTENSION_ID>/scripts/logger-client.js'

// Minimal (no stacks):
setupLoggerClient({
  context: 'content',
  targetExtensionId: '<LOGGER_EXTENSION_ID>'
})

// With error stack capture:
setupLoggerClient({
  context: 'content',
  targetExtensionId: '<LOGGER_EXTENSION_ID>',
  captureStacks: true
})

// With optional external auth token (if the logger has a token set, this must match):
setupLoggerClient({
  context: 'content',
  targetExtensionId: '<LOGGER_EXTENSION_ID>',
  token: '<SHARED_TOKEN>'
})
```

Supported `context` values: `background`, `content`, `page`, `sidebar`, `popup`, `options`, `devtools`.

2. Optional: enable/disable stack capture at runtime

```ts
// In the logger extension (e.g., DevTools console or background):
chrome.storage.session.set({logger_capture_stacks: true}) // or false
```

3. Optional: require a token for external logs (hardening)

```ts
// In the logger extension (e.g., DevTools console):
chrome.storage.local.set({logger_external_token: '<SHARED_TOKEN>'})

// Then pass the same token in your setupLoggerClient options:
setupLoggerClient({
  context: 'content',
  targetExtensionId: '<LOGGER_EXTENSION_ID>',
  token: '<SHARED_TOKEN>'
})
```

Notes

- The logger filters out its own logs; only the user extension(s) integrating the client will be captured.
- Logs are rate limited per sender and message parts are sanitized to prevent oversized payloads.
- The background service worker persists a recent slice of events and restores them on startup.

### Find your logger extension ID

- Open `chrome://extensions`
- Enable "Developer mode"
- Locate the centralized-logger and copy its "ID" (use this as `<LOGGER_EXTENSION_ID>`)

### Configuration knobs (in `background.ts`)

- `MAX_EVENTS` (default 1000): max in-memory buffer for broadcast
- Persisted slice size (default 200): saved to `chrome.storage.session`
- Save interval (default 2000ms): cadence for persisting the slice
- Rate limit (default 200 events/sec per sender)

Adjust in `background.ts` if you need different limits for your project.

### Usage by context

```ts
// Background (service worker)
import {setupLoggerClient} from 'chrome-extension://<LOGGER_EXTENSION_ID>/scripts/logger-client.js'
setupLoggerClient({
  context: 'background',
  targetExtensionId: '<LOGGER_EXTENSION_ID>'
})

// Content script
setupLoggerClient({
  context: 'content',
  targetExtensionId: '<LOGGER_EXTENSION_ID>'
})

// Popup
setupLoggerClient({
  context: 'popup',
  targetExtensionId: '<LOGGER_EXTENSION_ID>'
})

// Options
setupLoggerClient({
  context: 'options',
  targetExtensionId: '<LOGGER_EXTENSION_ID>'
})

// DevTools page
setupLoggerClient({
  context: 'devtools',
  targetExtensionId: '<LOGGER_EXTENSION_ID>'
})
```

### Security

- In production, consider restricting `externally_connectable.ids` to an allowlist of known user extensions.
- If using token hardening, set in logger extension:

```ts
chrome.storage.local.set({logger_external_token: '<SHARED_TOKEN>'})
```

and always call the client with:

```ts
setupLoggerClient({
  context: 'content',
  targetExtensionId: '<LOGGER_EXTENSION_ID>',
  token: '<SHARED_TOKEN>'
})
```

### Quick test checklist

- Content/background/popup logs appear in the sidebar
- SPA route changes are visible (History API updates)
- Tab create/update/remove events show
- `pagehide` and `visibility:hidden` events captured on navigation/unload
- Toggling `chrome.storage.session.logger_capture_stacks` adds/removes stacks on errors
- Incorrect tokens are rejected when `logger_external_token` is set
- Logs persist across service worker restarts (recent slice)

## Installation

```bash
npx extension@latest create <project-name> --template centralized-logger
cd <project-name>
npm install
```

## Commands

### dev

Run the extension in development mode.

```bash
npx extension@latest dev
```

### build

Build the extension for production.

```bash
npx extension@latest build
```

### Preview

Preview the extension in the browser.

```bash
npx extension@latest preview
```

## Learn more

Learn more about this and other templates at @https://extension.js.org/
