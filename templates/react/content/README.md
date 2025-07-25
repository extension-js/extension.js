# Content Script Integration

This directory contains a seamless integration between the content script wrapper and the React content script API.

## Architecture

The integration consists of two main components:

1. **`scripts.tsx`** - The simple React content script API
2. **`content-script-wrapper.ts`** - The wrapper that handles all the complexity
3. **`index.ts`** - The entry point that provides seamless integration

## Seamless Integration

The wrapper automatically imports and uses the default export from `scripts.tsx`, making the integration completely transparent. The API from `scripts.tsx` remains unchanged and works seamlessly with the wrapper.

### How It Works

1. **`scripts.tsx`** exports a default function that takes options and returns a render function
2. **`content-script-wrapper.ts`** imports this default export and wraps it with additional functionality
3. **`index.ts`** provides multiple ways to use the integration

## Usage Options

### Option 1: Auto-initialize (Simplest)

```typescript
import {contentScriptInstance} from './index'
// Automatically initializes with default options
```

### Option 2: Custom Options

```typescript
import {autoInitializeContentScript} from './index'

const instance = autoInitializeContentScript({
  rootId: 'my-extension',
  containerClass: 'my-content-script',
  customStylesheets: ['./styles.css', './custom.css']
})
```

### Option 3: Full Control

```typescript
import {ContentScriptWrapper} from './index'

const wrapper = new ContentScriptWrapper({
  rootId: 'my-extension',
  customStylesheets: ['./styles.css']
})

wrapper.mount((container) => {
  // Your custom rendering logic
  return () => {
    // Cleanup logic
  }
})
```

### Option 4: Direct Access

```typescript
import {contentScript} from './index'

const renderFunction = contentScript({
  rootId: 'my-extension',
  customStylesheets: ['./styles.css']
})
```

## API Compatibility

The `scripts.tsx` API remains unchanged:

```typescript
interface ContentScriptOptions {
  rootId?: string // ID for the root element (default: 'extension-root')
  containerClass?: string // CSS class for the container (default: 'content_script')
  customStylesheets?: string[] // Array of stylesheet paths to inject (default: ['./styles.css'])
}

export default function contentScript(options?: ContentScriptOptions) {
  return (container: HTMLElement) => {
    // React-specific rendering logic
    const mountingPoint = ReactDOM.createRoot(container)
    mountingPoint.render(<ContentApp />)

    // Return cleanup function for unmounting (required)
    return () => {
      mountingPoint.unmount()
    }
  }
}
```

## Features Provided by the Wrapper

- **Shadow DOM Management**: Automatic shadow DOM creation and management
- **CSS Injection**: Automatic injection of custom stylesheets
- **Hot Module Replacement (HMR)**: Support for webpack HMR
- **Lifecycle Management**: Proper mount/unmount handling
- **DOM Cleanup**: Automatic cleanup of DOM elements and resources
- **Error Handling**: Comprehensive error handling and logging

## Type Safety

The integration maintains full TypeScript support with proper type checking and IntelliSense support for all options and methods.

## Migration

If you're migrating from using `scripts.tsx` directly, you can simply:

1. Replace direct imports with the wrapper imports
2. Use the same options interface
3. Get all the additional features automatically

The wrapper is designed to be a drop-in replacement that adds functionality without breaking existing code.
