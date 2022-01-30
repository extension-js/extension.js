// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const browserSwitch = require('./browserSwitch')

process.on('unhandledRejection', (error) => {
  throw error
})

module.exports = (projectDir, {browserVendor}) => {
  const config = {
    mode: 'development',
    // https://github.com/webpack/webpack/issues/2145
    devtool: 'inline-cheap-module-source-map',
    plugins: [
      // Browser lists loaded conditionally based on user choice
      browserSwitch(projectDir, browserVendor)
    ],
    resolve: {
      extensions: ['js', '.json']
    }
  }

  return {
    ...config
  }
}
