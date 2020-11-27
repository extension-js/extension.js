//  ██╗   ███████╗████████╗ █████╗ ██████╗ ████████╗   ██╗
// ██╔╝   ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝   ╚██╗
// ██║    ███████╗   ██║   ███████║██████╔╝   ██║       ██║
// ██║    ╚════██║   ██║   ██╔══██║██╔══██╗   ██║       ██║
// ╚██╗   ███████║   ██║   ██║  ██║██║  ██║   ██║      ██╔╝
//  ╚═╝   ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝      ╚═╝

const resoleManifest = require('./steps/resolveManifest')
const startWebpack = require('./steps/startWebpack')

module.exports = async function (projectDir, manifestPath) {
  const resolvedManifest = await resoleManifest(projectDir, manifestPath)
  startWebpack(projectDir, resolvedManifest)
}
