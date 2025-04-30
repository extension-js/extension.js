# Add excludeBrowserFlags option

## Problem

The extension.js framework hardcodes several browser flags like `--hide-scrollbars` and `--mute-audio` in the Chromium browser configuration. Currently, there's no clean way to disable these flags without resorting to postinstall scripts that modify node_modules.

This is problematic for extensions that:
- Need to display scrollbars for UI testing
- Require audio functionality for multimedia features

## Solution

This PR adds a new `excludeBrowserFlags` option to the PluginInterface that allows users to specify which default flags should be excluded from the browser configuration. The implementation:

1. Adds a `DefaultBrowserFlags` type with JSDoc comments for all default flags
2. Extends the `PluginInterface` to include the `excludeBrowserFlags` option
3. Extracts default flags into a constant for maintainability
4. Adds filtering logic to remove excluded flags
5. Includes a complete example extension demonstrating the feature

## Implementation Details

- Added `DefaultBrowserFlags` union type to `browsers-types.ts`
- Added `excludeBrowserFlags?: Array<DefaultBrowserFlags | string>` to `PluginInterface`
- Modified `browserConfig` function in `run-chromium/browser-config.ts` to filter out excluded flags
- Added an example extension in `examples/browser-flags-example` that demonstrates the feature

## Example Usage

```javascript
// extension.config.js
module.exports = {
  browsers: {
    chrome: {
      // Disable scrollbar hiding and audio muting
      excludeBrowserFlags: ['--hide-scrollbars', '--mute-audio'],
      
      // Add your custom flags
      browserFlags: ['--autoplay-policy=no-user-gesture-required']
    }
  }
}
```

## Testing Done

- Verified that excluding `--hide-scrollbars` correctly allows scrollbars to appear
- Verified that excluding `--mute-audio` correctly allows audio playback
- Ensured backwards compatibility with existing configurations

## Screenshots

[Add screenshots if appropriate]
