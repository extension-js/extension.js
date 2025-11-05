import type {Compilation, Compiler} from '@rspack/core'

export type IssueType = 'error' | 'warning'

export function createIssue(
  compiler: Compiler,
  message: string,
  type: IssueType = 'error'
) {
  const ErrorCtor = compiler.rspack.WebpackError || Error
  const issue = new ErrorCtor(message) as Error & {name?: string}
  issue.name = type === 'warning' ? 'ExtensionWarning' : 'ExtensionError'
  return issue
}

export function reportToCompilation(
  compilation: Compilation,
  compiler: Compiler,
  message: string,
  type: IssueType = 'error'
) {
  const issue = createIssue(compiler, message, type)
  const bucket = type === 'warning' ? 'warnings' : 'errors'
  compilation[bucket] ||= []
  compilation[bucket].push(issue)
}

import * as fs from 'fs'
import * as path from 'path'

export function getScriptEntries(scriptPath: string | string[] | undefined) {
  const scriptEntries = Array.isArray(scriptPath)
    ? scriptPath || []
    : scriptPath
      ? [scriptPath]
      : []

  const fileAssets = scriptEntries.filter((scriptAsset) => {
    const validFile = fs.existsSync(scriptAsset)

    const assetExtension = path.extname(scriptAsset)

    return (
      validFile &&
      (assetExtension === '.js' ||
        assetExtension === '.mjs' ||
        assetExtension === '.jsx' ||
        assetExtension === '.ts' ||
        assetExtension === '.tsx')
    )
  })

  return fileAssets
}

export function getCssEntries(scriptPath: string | string[] | undefined) {
  const scriptEntries = Array.isArray(scriptPath)
    ? scriptPath || []
    : scriptPath
      ? [scriptPath]
      : []

  const fileAssets = scriptEntries.filter((scriptAsset) => {
    const validFile = fs.existsSync(scriptAsset)

    return (
      validFile &&
      (scriptAsset.endsWith('.css') ||
        scriptAsset.endsWith('.scss') ||
        scriptAsset.endsWith('.sass') ||
        scriptAsset.endsWith('.less'))
    )
  })

  return fileAssets
}
