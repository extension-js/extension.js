// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

/**
 * Defines user options for the webpack configuration.
 * In the future, this will be replaced by a configuration file. 
}*/
import path from 'path'

function getPublicFolderPath(projectPath: string) {
  return path.join(projectPath, 'public')
}

function getPagesFolderPath(projectPath: string) {
  return path.join(projectPath, 'pages')
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

function getOutputFilePath(chunkname: string, ext?: string) {
  // Special /pages path for scripts not defined in manifest.json
  if (chunkname.startsWith('pages')) {
    const [pagesFolder, filename] = chunkname.split('-')
    return `${pagesFolder}/${filename}${ext}`
  }

  // Special /script path for scripts not defined in manifest.json
  if (chunkname.startsWith('scripts')) {
    const [scriptsFolder, filename] = chunkname.split('-')
    return `${scriptsFolder}/${filename}${ext}`
  }

  return chunkname + ext
}

export {
  getPublicFolderPath,
  getPagesFolderPath,
  getScriptsFolderPath,
  getWebResourcesFolderPath,
  getPort,
  getOverlay,
  getOutputFilePath
}
