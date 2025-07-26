# Monorepo Turbopack Example

This example demonstrates how to structure multiple browser extensions using Extension.js in a monorepo setup with Turborepo for build optimization.

## Structure

```
monorepo-turbopack/
├── package.json              # Root package.json with shared dependencies
├── clients/                  # Extension packages
│   ├── browser/             # Browser extension
│   │   ├── manifest.json
│   │   ├── package.json
│   │   ├── content.js
│   │   ├── background.js
│   │   └── popup.html
│   └── analytics/           # Analytics extension
│       ├── manifest.json
│       ├── package.json
│       ├── content.js
│       ├── background.js
│       ├── popup.html
│       └── popup.js
└── packages/                # Shared packages
    └── base/               # Base utilities
        ├── package.json
        ├── index.js
        └── services/
```

## Usage

### Development

To develop a specific extension:

```bash
# Develop the browser extension
pnpm extension dev ./clients/browser

# Develop the analytics extension
pnpm extension dev ./clients/analytics
```

### Building

To build a specific extension:

```bash
# Build the browser extension
pnpm extension build ./clients/browser

# Build the analytics extension
pnpm extension build ./clients/analytics
```

### Monorepo Commands

Using the root package.json scripts:

```bash
# Build all extensions
pnpm build-browser

# Start development for browser extension
pnpm dev-browser
```

## Key Features

- **Monorepo Structure**: Multiple extensions in a single repository
- **Shared Dependencies**: Common dependencies managed at the root level
- **Workspace Management**: Uses pnpm workspaces for package management
- **Turborepo Integration**: Parallel builds and caching for optimal performance
- **Extension.js Integration**: Each extension uses Extension.js for development and building
- **Type Safety**: Full TypeScript support across all packages

## Monorepo Benefits

1. **Code Sharing**: Share utilities and components between extensions
2. **Dependency Management**: Centralized dependency management with pnpm workspaces
3. **Build Optimization**: Parallel builds and caching with Turborepo
4. **Consistent Tooling**: Same Extension.js development tools across all extensions
5. **Version Management**: Coordinated releases across extensions
6. **Type Safety**: Shared TypeScript configurations and type definitions
