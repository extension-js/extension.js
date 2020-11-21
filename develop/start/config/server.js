module.exports = {
  // 'info': 'silent' | 'trace' | 'debug' |
  // 'warn' | 'error' | 'none' | 'warning'
  clientLogLevel: 'none',
  compress: true,
  hot: true,
  overlay: true,
  quiet: true,
  watchContentBase: true,
  watchOptions: {
    ignored: 'node_modules'
  },
  writeToDisk: true
}
