//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const path = require('path')

const templatesDir = path.resolve(__dirname, '../templates')
const templateTempDir = (template) => `__temp__${template}`

module.exports = function (template) {
  let thisTemplate

  if (template) {
    thisTemplate = templateTempDir(template)
  } else {
    thisTemplate = 'standard'
  }

  return path.resolve(templatesDir, thisTemplate)
}
