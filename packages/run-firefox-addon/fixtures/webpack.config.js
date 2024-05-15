const path = require('path')

const OpenFirefoxExtension = require('../module')

module.exports = {
  cache: false,
  mode: 'development',
  watch: true,
  entry: {},
  plugins: [
    new OpenFirefoxExtension({
      extensionPath: path.resolve(__dirname, './demo-extension'),
      // The fields below are not required
      browserFlags: [
        '--enable-experimental-extension-apis',
        '--embedded-extension-options'
      ],
      userDataDir: path.resolve(__dirname, 'my-awesome-user-data-dir'),
      startingUrl: 'https://example.com',
      autoReload: true,
      port: 8081
    })
  ]
}
