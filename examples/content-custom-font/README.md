<a href="https://extension.js.org" target="_blank"><img src="https://img.shields.io/badge/Powered%20by%20%7C%20Extension.js-0971fe" alt="Powered by Extension.js" align="right" /></a>

# content/custom-font

Content Custom Font Example

> A browser extension example demonstrating how to load custom fonts with Tailwind CSS v4. Shows proper font file placement, web accessible resources configuration, and CSS font-face declarations for browser extensions.

What this example does in the scope of a browser extension. The description should
describe for an audience of developers looking to use the example. Avoid jargon and
use simple language.

## Installation

```bash
npx extension@latest create <project-name> --template content-custom-font
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

Learn more about this and other examples at @https://extension.js.org/

## Setup Instructions

- Place your font files under `public/fonts/`.
- Update CSS `@font-face` declarations to reference files in `public/fonts/`.

## Troubleshooting

- If fonts fail to load, verify `web_accessible_resources` includes `fonts/*` patterns.
- Confirm your CSS paths are correct and relative to the stylesheet.

## Best Practices

- Use `font-display: swap` to improve perceived performance.
- Prefer modern formats like WOFF2 when available.

See GitHub Issue #271 for additional context.
