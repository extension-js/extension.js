//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import path from 'node:path'
import type {AnyDevelopModule} from './extension-develop-runtime'

// dev anchors its session files at the package root it walks up to from the
// manifest, so readers ask the same walk; an older bridge without it keeps
// the argument as given.
export function resolveSessionProjectPath(
  bridge: AnyDevelopModule,
  pathArg?: string
): string {
  const inputPath = path.resolve(pathArg || process.cwd())
  const resolve = bridge?.resolveSessionProjectRoot
  if (typeof resolve !== 'function') return inputPath
  try {
    const resolved = resolve(inputPath)
    return typeof resolved === 'string' && resolved ? resolved : inputPath
  } catch {
    return inputPath
  }
}

function sessionFilePath(
  bridge: AnyDevelopModule,
  exportName: 'readyContractPath' | 'logsPath',
  projectPath: string,
  browser: string,
  fileName: string
): string {
  const fn = bridge?.[exportName]
  if (typeof fn === 'function') {
    try {
      const resolved = fn(projectPath, browser)
      if (typeof resolved === 'string' && resolved) return resolved
    } catch {
      // Ignore
    }
  }
  return path.join(projectPath, 'dist', 'extension-js', browser, fileName)
}

export function sessionReadyPath(
  bridge: AnyDevelopModule,
  projectPath: string,
  browser: string
): string {
  return sessionFilePath(
    bridge,
    'readyContractPath',
    projectPath,
    browser,
    'ready.json'
  )
}

export function sessionLogsPath(
  bridge: AnyDevelopModule,
  projectPath: string,
  browser: string
): string {
  return sessionFilePath(
    bridge,
    'logsPath',
    projectPath,
    browser,
    'logs.ndjson'
  )
}
