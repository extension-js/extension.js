const RunChromeExtension = require('webpack-run-chrome-extension')
const RunEdgeExtension = require('webpack-run-edge-extension')

module.exports = function (projectDir, browserVendor) {
  switch (browserVendor) {
    case 'chrome':
      return new RunChromeExtension({extensionPath: projectDir})

    case 'edge':
      return new RunEdgeExtension({extensionPath: projectDir})

    case 'all':
      return {
        apply: (compiler) => {
          new RunChromeExtension({
            extensionPath: projectDir,
            port: 8081
          }).apply(compiler)

          new RunEdgeExtension({
            extensionPath: projectDir,
            port: 8082
          }).apply(compiler)
        }
      }

    default:
      // TODO: Should be the user default browser, not Chrome
      return new RunChromeExtension({extensionPath: projectDir})
  }
}
