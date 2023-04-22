//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const path = require('path')

const templatesDir = path.resolve(__dirname, '../templates')
const templateTempDir = (template) => `__temp__${template}`

module.exports = function getTemplatePath(template, isExternalTemplate) {
  let thisTemplate

  if (isExternalTemplate) {
    thisTemplate = templateTempDir(template)
  } else {
    thisTemplate = 'standard'
  }

  return path.resolve(templatesDir, thisTemplate)
}
