// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import {isUsingTypeScript} from '../options/typescript'
import {isUsingPreact} from '../options/preact'

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

function getAliasToResolve(projectPath: string) {
  return isUsingPreact(projectPath)
    ? {
        react: 'preact/compat',
        'react-dom/test-utils': 'preact/test-utils',
        'react-dom': 'preact/compat', // 必须放在 test-utils 下面
        'react/jsx-runtime': 'preact/jsx-runtime'
      }
    : undefined
}

export {
  getManifestPath,
  getOutputPath,
  getWebpackPublicPath,
  getModulesToResolve,
  getScriptResolveExtensions,
  getExtensionsToResolve,
  getAliasToResolve
}
