/**
 * @type {import('extension').FileConfig}
 *
 * This example demonstrates how to use the excludeBrowserFlags option
 * to disable specific default browser flags like hiding scrollbars or muting audio.
 */
const config = {
  browser: {
    chrome: {
      // Disable scrollbar hiding and audio muting for development
      excludeBrowserFlags: [
        '--hide-scrollbars', // Allow scrollbars to be visible
        '--mute-audio', // Allow audio to play
        '--disable-component-extensions-with-background-pages' // Allow component extensions to load
      ],

      // You can also add custom browser flags
      browserFlags: [
        // TEMPORARILY COMMENTED OUT TO TEST EXTENSION LOADING
        // Test flag to verify browser flags are working (safer than --disable-web-security)
        // '--disable-features=VizDisplayCompositor',
        // Additional flags for Chrome
        // '--autoplay-policy=no-user-gesture-required',
        // '--disable-features=PreloadMediaEngagementData,AutoplayIgnoreWebAudio'
      ],

      // Open a specific URL when launching
      startingUrl: 'https://extension.js.org'
    },

    firefox: {
      // Firefox uses a different configuration approach
      // but excludeBrowserFlags is also supported for consistency
      excludeBrowserFlags: [],
      browserFlags: ['--kiosk'],
      startingUrl: 'about:debugging#/runtime/this-firefox'
    }
  }
}

export default config
