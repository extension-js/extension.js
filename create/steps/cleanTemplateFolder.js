const fs = require('fs-extra')
const { log } = require('log-md')

const getTemplatePath = require('./getTemplatePath')

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
