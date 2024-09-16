/** @type {import('extension').FileConfig} */
module.exports = {
  browsers: {
    chrome: {
      // noOpen?: boolean
      // userDataDir?: string
      // profile?: string
      // preferences?: Record<string, any>
      // browserFlags?: string[]
      // startingUrl?: string
      // chromiumBinary?: string
      startingUrl: 'https://extension.js.org'
    },
    firefox: {
      // noOpen?: boolean
      // userDataDir?: string
      // profile?: string
      // preferences?: Record<string, any>
      // browserFlags?: string[]
      // startingUrl?: string
      // geckoBinary?: string
      startingUrl: 'about:debugging#/runtime/this-firefox'
    }
  },
  development: {
    // TBD
    // browser: DevOptions['browser']
    // port?: number
    // browser: 'firefox', // can be an array
    // zipFilename?: string
    // zip?: boolean
    // zipSource?: boolean
    // polyfill?: boolean
  },
  deployment: {}
}
