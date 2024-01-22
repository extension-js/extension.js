// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'

function getManifestPath(projectPath: string) {
  return path.resolve(projectPath, 'manifest.json')
}

function getOutputPath(projectPath: string, browser: string | undefined) {
  // Output path points to a top level folder within the extension bundle
  // named after the browser. This is to allow for multiple browser builds
  // to be placed in the same folder.
  const distFolderName = `dist/${browser || 'chrome'}`

  return path.join(projectPath, distFolderName)
}

function getWebpackPublicPath(_projectPath?: string) {
  return '/'
}

function getStaticFolderPath(projectPath: string) {
  return path.join(projectPath, 'public/')
}

function getDynamicPagesPath(_projectPath: string) {
  return './pages'
}

function getWebResourcesFolderPath(projectPath: string) {
  return path.join(projectPath, 'web_accessible_resources')
}

function getModulesToResolve(projectPath: string) {
  return ['node_modules', path.join(projectPath, 'node_modules')]
}

export {
  getManifestPath,
  getOutputPath,
  getWebpackPublicPath,
  getStaticFolderPath,
  getDynamicPagesPath,
  getWebResourcesFolderPath,
  getModulesToResolve
}
