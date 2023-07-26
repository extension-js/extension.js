// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'

function getOutputPath(projectPath: string, browser: string | undefined) {
  const distFolderName = `_extension/${browser || 'chrome'}`

  // Output path points to a top level folder within the extension bundle
  return path.resolve(projectPath, distFolderName)
}

function getWebpackPublicPath(projectPath: string) {
  return '/'
}

function getStaticFolderPath(projectPath: string) {
  return path.join(projectPath, 'public')
}

function getWebResourcesFolderPath(projectPath: string) {
  return path.join(projectPath, 'webResources')
}

function getModulesToResolve(projectPath: string) {
  return ['node_modules', path.join(projectPath, 'node_modules')]
}

export {
  getOutputPath,
  getWebpackPublicPath,
  getStaticFolderPath,
  // getDynamicPagesPath,
  getWebResourcesFolderPath,
  getModulesToResolve
}
