// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const browserSwitch = require('./browserSwitch')

module.exports = (projectDir, {browserVendor}) => {
  const config = {
    mode: 'development',
    entry: {},
    // https://github.com/webpack/webpack/issues/2145
    devtool: 'inline-cheap-module-source-map',
    plugins: [
      // Browser lists loaded conditionally based on user choice
      browserSwitch(projectDir, browserVendor)
    ]
  }

  return {
    ...config
  }
}
