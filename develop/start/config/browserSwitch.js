const RunChromeExtension = require('webpack-run-chrome-extension')
const RunEdgeExtension = require('webpack-run-edge-extension')

module.exports = function (projectDir, browserVendor) {
  switch (browserVendor) {
    case 'chrome':
      return new RunChromeExtension({extensionPath: projectDir})

    case 'edge':
      return new RunEdgeExtension({extensionPath: projectDir})

    default:
      // TODO: Should be the user default browser, not Chrome
      return new RunChromeExtension({extensionPath: projectDir})
  }
}
