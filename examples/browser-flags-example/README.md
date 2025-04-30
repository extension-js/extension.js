# Browser Flags Example

This example demonstrates how to customize browser flags when developing extensions with extension.js.

## Key Features

- Excluding default browser flags (new feature)
- Adding custom browser flags
- Browser-specific configuration

## The Problem

By default, extension.js applies certain flags to the browser during development, including:

- `--hide-scrollbars`: Hides scrollbars in the browser window, which can be problematic for UI testing
- `--mute-audio`: Mutes all audio in the browser, which blocks sound-related features

Previously, there was no clean way to disable these default flags. Users had to resort to post-install scripts that modified the source code.

## The Solution: excludeBrowserFlags

The `excludeBrowserFlags` option allows you to specify which default flags should be removed from the browser configuration.

```javascript
module.exports = {
  browsers: {
    chrome: {
      excludeBrowserFlags: [
        '--hide-scrollbars',  // Allow scrollbars to be visible
        '--mute-audio'        // Allow audio to play
      ]
    }
  }
}
```

## Available Default Flags

Extension.js sets the following default flags that can be excluded:

| Flag | Description |
|------|-------------|
| `--no-first-run` | Disable Chrome's native first run experience |
| `--disable-client-side-phishing-detection` | Disables client-side phishing detection |
| `--hide-scrollbars` | Hide scrollbars from screenshots |
| `--mute-audio` | Mute all audio in the browser |
| `--no-default-browser-check` | Disable the default browser check |
| `--ash-no-nudges` | Avoids blue bubble "user education" nudges |
| `--disable-features=MediaRoute` | Disable Chrome Media Router |
| `--disable-background-networking` | Disable various background network services |
| `--disable-sync` | Disable syncing to a Google account |
| `--no-pings` | Don't send hyperlink auditing pings |

And many more - see the full list in the source code.

## Type Safety

The `excludeBrowserFlags` option is fully typed, providing autocompletion and documentation in supported editors:

```typescript
/**
 * Array of browser flags to exclude from the default set
 * @example ['--hide-scrollbars', '--mute-audio']
 */
excludeBrowserFlags?: Array<DefaultBrowserFlags | string>
```

## Common Use Cases

### Enabling Audio for Development

```javascript
module.exports = {
  browsers: {
    chrome: {
      excludeBrowserFlags: ['--mute-audio'],
      browserFlags: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=PreloadMediaEngagementData,AutoplayIgnoreWebAudio'
      ]
    }
  }
}
```

### Showing Scrollbars

```javascript
module.exports = {
  browsers: {
    chrome: {
      excludeBrowserFlags: ['--hide-scrollbars']
    }
  }
}
