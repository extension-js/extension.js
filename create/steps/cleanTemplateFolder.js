const fs = require('fs-extra')
const getTemplatePath = require('./getTemplatePath')
const { log } = require('log-md')

module.exports = async function (template) {
  // We don't want to delete local templates
  if (!template) {
    return
  }

  log('🧹 - Cleaning up everything...')

  try {
    await fs.remove(getTemplatePath(template))
  } catch (error) {
    log(`😕❓ Removing \`${template}\` failed: ${error}`)
  }
}
