# @extension-js-devtools

Centralized DevTools UI for Extension.js. This panel runs inside the browser's DevTools and is independent from the CLI unified logging.

- Independent from CLI `--logs` and `--log-context` flags.
- Use the browser DevTools to view this panel and its logs/UI.
- CLI logging (`extension dev --logs=... --log-context=...`) controls only what is printed in your terminal, primarily from Chromium CDP sources.
