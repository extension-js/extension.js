const RunChromeExtension = require('webpack-run-chrome-extension')
const RunEdgeExtension = require('webpack-run-edge-extension')

module.exports = function browserSwitch(projectDir, browserVendor) {
  if (browserVendor === 'chrome') {
    return new RunChromeExtension({extensionPath: projectDir})
  }

  if (browserVendor === 'edge') {
    return new RunEdgeExtension({extensionPath: projectDir})
  }

  if (browserVendor === 'all') {
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
  }

  // Default to user browser
  return browserVendor
}
