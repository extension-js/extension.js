const path = require('path')

const templatesDir = path.resolve(__dirname, '../templates')
const templateTempDir = (template) => `__temp__${template}`

module.exports = function (template) {
  let thisTemplate

  if (template) {
    thisTemplate = templateTempDir(template)
  } else {
    thisTemplate = 'cbe-standard-template'
  }

  return path.resolve(templatesDir, thisTemplate)
}
