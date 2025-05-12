# Extension.js Monorepo Example

This example demonstrates how to use Extension.js in a monorepo structure, specifically with Nx or similar monorepo tools.

## Structure

```
monorepo/
├── package.json                  # Root package.json with shared dependencies
├── apps/
│   └── extension/                # Extension app
│       ├── package.json          # Minimal package.json for the extension
│       ├── manifest.json         # Extension manifest
│       ├── extension.config.js   # Custom webpack config for monorepo
│       └── content/              # Content scripts
│           ├── scripts.tsx
│           └── styles.scss
```

## Key Features

1. **Shared Dependencies**: React, TypeScript, and SASS are installed at the root level
2. **Custom Webpack Config**: Uses a custom plugin to handle TypeScript and SASS files from the monorepo root
3. **Shadow DOM**: Styles are properly scoped using Shadow DOM
4. **Development Experience**: Supports hot reloading and development mode

## Setup

1. Install dependencies at the root:

   ```bash
   pnpm install
   ```

2. Build the extension:

   ```bash
   pnpm build
   ```

3. Start development:
   ```bash
   pnpm dev
   ```

## Custom Webpack Configuration

The `extension.config.js` file includes a custom plugin that:

1. Handles TypeScript/TSX files using SWC
2. Processes SASS files with proper Shadow DOM injection
3. Maintains compatibility with the monorepo structure

## Notes

- The extension app's `package.json` is minimal as dependencies are managed at the root
- Styles are properly scoped using Shadow DOM to prevent conflicts
- The setup supports both development and production builds
