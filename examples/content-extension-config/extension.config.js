/** @type {import('extension-develop').FileConfig} */
module.exports = {
  browsers: {
    chrome: {
      startingUrl: 'https://extension.js.org'
    },
    firefox: {
      startingUrl: 'about:debugging#/runtime/this-firefox'
    }
  },
  commands: {
    dev: {
      browser: 'firefox',
      polyfill: true
    },
    start: {
      browser: 'firefox',
      polyfill: true
    },
    preview: {
      browser: 'firefox',
      polyfill: true
    },
    build: {
      browser: 'firefox',
      polyfill: true
    }
  }
}
