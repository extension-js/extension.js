[powered-image]: https://img.shields.io/badge/Powered%20by-Extension.js-0971fe
[powered-url]: https://extension.js.org

[![Powered by Extension.js][powered-image]][powered-url]

# Extension.js devtools

The companion extension Extension.js loads next to yours during development.
It opens the welcome page on a first run, points the launch tab at the
browser's extensions page, keeps the new tab blank, and reads the per-session
`extension-js-session.json` flag so `--no-open` opens nothing at all.

## Build

Run a browser-targeted build:

```bash
pnpm run build:chrome
pnpm run build:edge
pnpm run build:firefox
```

## Learn more

Learn more in the [Extension.js docs](https://extension.js.org).
