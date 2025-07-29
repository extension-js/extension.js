# Enhanced Reload System

## Overview

The Enhanced Reload System solves the background script caching issue by implementing a hybrid approach that combines WebSocket-based communication with direct browser API calls, inspired by web-ext's successful reloading strategy.

## Problem Solved

**Background Script Caching Issue**: Previously, when background scripts or manifest files were updated, the changes weren't always reflected immediately due to browser caching mechanisms. Users would see stale code even when the files in the `dist` directory were updated.

## Solution Architecture

### 1. **CDP-Based Reloading (Chrome 126+)**

- Uses Chrome DevTools Protocol (CDP) `Extensions.loadUnpacked` command
- Directly reloads extensions at the browser level
- Bypasses caching issues by forcing complete extension reload

### 2. **Fallback to chrome.developerPrivate API (Older Chrome)**

- For Chrome versions before 126, uses `chrome.developerPrivate.reload()` API
- Creates a temporary chrome://extensions/ tab to execute reload commands
- Maintains compatibility with older browser versions

### 3. **Enhanced WebSocket Communication**

- Improved message dispatching for critical files
- Better error handling and logging
- Cache-busting mechanisms

### 4. **Cache-Busting Mechanisms**

- Timestamp-based cache busting in manifests
- Background script age detection
- Storage clearing before reloads

## Implementation Details

### Critical Files Detection

The system identifies critical files that require direct browser reloading:

```typescript
const criticalFiles = [
  'manifest.json',
  'background.js',
  'background.ts',
  'service-worker.js',
  'service-worker.ts'
]
```

### Enhanced Background Script Injection

Background scripts now include:

1. **Enhanced reload handlers** with better error handling
2. **Cache-busting mechanisms** that detect stale scripts
3. **Storage clearing** before reloads
4. **Detailed logging** for debugging

### CDP Client Implementation

```typescript
// Modern approach (Chrome 126+)
await this.sendCommand('Extensions.loadUnpacked', {
  path: extensionPath
})

// Fallback for older Chrome versions
await this.reloadExtensionFallback(extensionPath)
```

## Usage

The enhanced reload system is automatically enabled when using the development server. No additional configuration is required.

### Browser Support

- **Chrome 126+**: Uses CDP `Extensions.loadUnpacked`
- **Chrome <126**: Uses `chrome.developerPrivate.reload()` fallback
- **Firefox**: Uses enhanced WebSocket communication with cache-busting

### Logging

The system provides detailed logging to help debug reload issues:

```
🔧 Initializing enhanced reload service for Chromium-based browser
✅ Enhanced reload service initialized successfully
📁 File changed: background.js (Critical: true)
🚀 Using CDP-based reloading for critical file
✅ Enhanced reload completed for: background.js
✅ Cache buster added to manifest
```

## Benefits

1. **Reliable Background Script Updates**: Critical files are now reliably reloaded
2. **Backward Compatibility**: Works with older Chrome versions
3. **Cross-Browser Support**: Handles both Chrome and Firefox
4. **Better Debugging**: Comprehensive logging for troubleshooting
5. **Graceful Fallbacks**: Falls back to WebSocket if CDP fails

## Troubleshooting

### CDP Connection Issues

If you see "Failed to initialize CDP client" warnings:

- The system will automatically fall back to WebSocket-only mode
- This is normal and doesn't affect functionality

### Background Script Still Not Updating

1. Check browser console for error messages
2. Verify the file is being detected as critical
3. Check if the CDP client is connected
4. Look for cache-busting timestamps in the manifest

### Firefox-Specific Issues

Firefox uses a different approach:

- Enhanced WebSocket communication
- Cache-busting mechanisms
- Storage clearing before reloads

## Technical Notes

- The CDP client uses a separate port (base port + 1000) to avoid conflicts
- Cache busting adds timestamps to manifests to force reloads
- Background scripts include age detection to force reloads of stale scripts
- The system maintains the existing WebSocket infrastructure for non-critical files
