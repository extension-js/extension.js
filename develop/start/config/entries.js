const resolveBackgroundEntries =
  require('../resolve/resolveBackgroundScriptEntries')

module.exports = function (manifestPath) {
  const manifest = require(manifestPath)
  const config = {
    entry: {}
  }

  if (manifest.background) {
    config.entry.background = resolveBackgroundEntries(manifestPath)
  }

  return config
}
