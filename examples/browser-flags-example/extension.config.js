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
        '--mute-audio' // Allow audio to play
      ],

      // You can also add custom browser flags
      browserFlags: [
        // Additional flags for Chrome
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=PreloadMediaEngagementData,AutoplayIgnoreWebAudio'
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
  },

  development: {
    // Development options
    polyfill: true
  }
}

export default config
