const path = require('path')

const modifyBackgroundScript = (backgroundScriptEntry) => {
  if (!backgroundScriptEntry) return {}

  const scripts = backgroundScriptEntry.map(script => path.basename(script))
  return {
    background: { scripts }
  }
}

module.exports = modifyBackgroundScript
