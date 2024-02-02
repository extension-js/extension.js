// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
// import getNextAvailablePort from './getNextAvailablePort'

function getStaticFolderPath(projectPath: string) {
  return path.join(projectPath, 'public')
}

function getPagesFolderPath(_projectPath: string) {
  return './pages'
}

function getScriptsFolderPath(projectPath: string) {
  return path.join(projectPath, 'scripts')
}

function getWebResourcesFolderPath(projectPath: string) {
  return path.join(projectPath, 'web_accessible_resources')
}

function getPort(port: number = 8818) {
  // TODO: cezaraugusto scan available ports
  // const nextPort = await getNextAvailablePort(port)
  return port
}

function getOverlay() {
  return {
    errors: false,
    warnings: false
  }
}

export {
  getStaticFolderPath,
  getPagesFolderPath,
  getScriptsFolderPath,
  getWebResourcesFolderPath,
  getPort,
  getOverlay
}
