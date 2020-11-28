const path = require('path')
const ChromeLauncher = require('chrome-launcher');
const browserConfig = require('../config/browser')

const defaultFlags = ChromeLauncher
  .Launcher.defaultFlags()
  .filter(flag => flag !== '--disable-extensions')

async function openExtensionInBrowser(projectDir, userOptions) {
  const extensionDist = path.join(projectDir, 'dist')
  const config = browserConfig(extensionDist, defaultFlags, userOptions)

  await ChromeLauncher.launch(config)
}

async function closeBrowser() {
  await ChromeLauncher.killAll()
}

module.exports = {
  openExtensionInBrowser,
  closeBrowser
}
