<a href="https://extension.js.org" target="_blank"><img src="https://img.shields.io/badge/Powered%20by%20%7C%20Extension.js-0971fe" alt="Powered by Extension.js" align="right" /></a>

# content/react

> A modern browser extension content script example built with Extension.js and React. Demonstrates how to create interactive content scripts using React components with clean, maintainable code.

What this example does in the scope of a browser extension. The description should
describe for an audience of developers looking to use the example. Avoid jargon and
use simple language.

## Installation

```bash
npx extension@latest create <project-name> --template content-react
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

## Development (HMR)

- Hot reload for content scripts, styles, and React components is automatic in development (`npx extension@latest dev`).
- Do not add framework/tool-specific HMR code (no `import.meta.webpackHot` / `import.meta.hot`). Extension.js injects and manages HMR for you.

## Learn more

Learn more about this and other examples at @https://extension.js.org/
