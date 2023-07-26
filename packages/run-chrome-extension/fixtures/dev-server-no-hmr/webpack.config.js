const path = require('path')

const RunChromeExtension = require('../../dist/module').default

module.exports = {
  cache: false,
  mode: 'development',
  entry: {},
  output: {
    path: path.resolve(__dirname, 'dist')
  },
  plugins: [
    new RunChromeExtension({
      // Needed for autoReload to work
      manifestPath: path.resolve(__dirname, 'manifest.json'),
      // Needed for the browser to load the extension properly
      extensionPath: path.resolve(__dirname),
      // Fields below are not required
      browserFlags: [
        '--enable-experimental-extension-apis',
        '--embedded-extension-options'
      ],
      userDataDir: path.resolve(__dirname, 'dist', 'my-awesome-user-data-dir'),
      startingUrl: 'https://example.com',
      autoReload: true,
      port: 8082
    })
  ],
  devServer: {
    allowedHosts: 'all',
    static: {
      directory: path.resolve(__dirname),
      watch: {
        ignored: [/\bnode_modules\b/]
      }
    },
    client: {
      // Allows to set log level in the browser, e.g. before reloading,
      // before an error or when Hot Module Replacement is enabled.
      logging: 'error',
      // Prints compilation progress in percentage in the browser.
      progress: true,
      // Shows a full-screen overlay in the browser
      // when there are compiler errors or warnings.
      overlay: {
        errors: true,
        warnings: true
      }
    },
    devMiddleware: {
      writeToDisk: true
    },
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    hot: false
  }
}
