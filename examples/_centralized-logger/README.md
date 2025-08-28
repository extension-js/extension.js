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
