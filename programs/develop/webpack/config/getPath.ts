// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import {isUsingTypeScript} from '../options/typescript'

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

function getModulesToResolve(projectPath: string) {
  return ['node_modules', path.join(projectPath, 'node_modules')]
}

function getScriptResolveExtensions(projectPath: string) {
  return [
    '.js',
    '.mjs',
    '.jsx',
    '.mjsx',
    ...(isUsingTypeScript(projectPath) ? ['.ts', '.mts', '.tsx', '.mtsx'] : [])
  ]
}

function getExtensionsToResolve(projectPath: string) {
  return [...getScriptResolveExtensions(projectPath), '.json', '.wasm']
}

export {
  getManifestPath,
  getOutputPath,
  getWebpackPublicPath,
  getModulesToResolve,
  getScriptResolveExtensions,
  getExtensionsToResolve
}
