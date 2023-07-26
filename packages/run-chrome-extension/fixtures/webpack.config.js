const path = require('path')

const RunChromeExtension = require('../dist/module').default

module.exports = {
  cache: false,
  mode: 'development',
  watch: true,
  entry: {},
  output: {
    path: path.resolve(__dirname, 'dist')
  },
  plugins: [
    new RunChromeExtension({
      // Needed for autoReload to work
      manifestPath: path.resolve(
        __dirname,
        './demo-extension',
        'manifest.json'
      ),
      // Needed for the browser to load the extension properly
      extensionPath: path.resolve(__dirname, './demo-extension'),
      // Fields below are not required
      browserFlags: [
        '--enable-experimental-extension-apis',
        '--embedded-extension-options'
      ],
      userDataDir: path.resolve(
        __dirname,
        'demo-extension',
        'dist',
        'my-awesome-user-data-dir'
      ),
      startingUrl: 'https://example.com',
      autoReload: true,
      port: 8082
    })
  ]
}
