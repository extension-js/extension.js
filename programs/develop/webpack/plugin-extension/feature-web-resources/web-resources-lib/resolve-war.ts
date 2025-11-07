import * as fs from 'fs'
import * as path from 'path'
import {Compilation, sources, WebpackError} from '@rspack/core'
import {unixify} from '../../../webpack-lib/paths'
import * as warMessages from './messages'

function isPublicRootLike(possiblePath: string) {
  const normalizedPath = unixify(possiblePath || '')
  return (
    normalizedPath.startsWith('/') ||
    /^(?:\.\/)?public\//i.test(normalizedPath) ||
    /^\/public\//i.test(normalizedPath)
  )
}

function toPublicOutput(possiblePath: string) {
  const normalizedPath = unixify(possiblePath || '')
  if (/^\/public\//i.test(normalizedPath)) {
    return normalizedPath.replace(/^\/public\//i, '')
  } else if (/^(?:\.\/)?public\//i.test(normalizedPath)) {
    return normalizedPath.replace(/^(?:\.\/)?public\//i, '')
  } else if (/^\//.test(normalizedPath)) {
    return normalizedPath.replace(/^\//, '')
  }

  return normalizedPath
}

function emitFileAsAsset(compilation: Compilation, absPath: string): string {
  const mode = compilation.options?.mode || 'development'
  const filenamePattern =
    mode === 'production'
      ? 'assets/[name].[contenthash:8][ext]'
      : 'assets/[name][ext]'

  const ext = path.extname(absPath)
  const name = path.basename(absPath, ext)
  const content = fs.readFileSync(absPath)

  let outName = filenamePattern.replace('[name]', name).replace('[ext]', ext)

  if (outName.includes('[contenthash:8]')) {
    const crypto = require('crypto') as typeof import('crypto')
    const hash = crypto
      .createHash('sha1')
      .update(content)
      .digest('hex')
      .slice(0, 8)
    outName = outName.replace('[contenthash:8]', hash)
  }

  if (!compilation.getAsset(outName)) {
    compilation.emitAsset(outName, new sources.RawSource(content))
  }

  compilation.fileDependencies.add(absPath)

  return unixify(outName)
}

function isFirefox(browser?: string) {
  return !!browser && browser.toLowerCase().includes('firefox')
}

function isValidChromeMatchPattern(pattern: string): boolean {
  // Special token is allowed by Chrome for WAR
  if (pattern === '<all_urls>') return true

  if (/[?#]/.test(pattern)) return false

  if (!pattern.endsWith('/*')) return false

  const parseable = pattern.replace(/^\*:\/\//, 'https://')

  try {
    const u = new URL(parseable)
    return u.pathname === '/'
  } catch {
    return false
  }
}

function validateMatchesOrReport(
  compilation: Compilation,
  matches: string[] | undefined,
  browser?: string
) {
  if (!matches || isFirefox(browser)) return
  compilation.errors ||= []

  for (const m of matches) {
    if (!isValidChromeMatchPattern(m)) {
      const msg = warMessages.warInvalidMatchPattern(m)
      const err = new WebpackError(msg) as Error & {
        file?: string
        name?: string
      }
      err.file = 'manifest.json'
      err.name = 'WARInvalidMatchPattern'
      compilation.errors!.push(err)
    }
  }
}

export function resolveUserDeclaredWAR(
  compilation: Compilation,
  manifestPath: string,
  manifest: unknown,
  browser?: string
) {
  const v2 = new Set<string>()
  const v3: Array<{matches: string[]; resources: Set<string>}> = []

  const manifestObj = manifest as {
    manifest_version?: number
    web_accessible_resources?: unknown
    content_scripts?: unknown
  }
  const war = manifestObj.web_accessible_resources as
    | string[]
    | Array<{resources: string[]; matches?: string[]}>
    | undefined

  if (!war) return {v2, v3}

  const isV2 = Array.isArray(war) && typeof war[0] === 'string'
  const manifestDir = path.dirname(manifestPath)
  const projectPath = (compilation.options?.context as string) || manifestDir

  const pushResource = (matches: string[] | undefined, resource: string) => {
    if (manifestObj.manifest_version === 2 || isV2) {
      v2.add(resource)
      return
    }

    const key = (matches || []).join(',')
    let group = v3.find((g) => g.matches.join(',') === key)

    if (!group) {
      group = {matches: matches || [], resources: new Set()}
      v3.push(group)
    }

    group.resources.add(resource)
  }

  const handleOne = (matches: string[] | undefined, res: string) => {
    compilation.errors = compilation.errors || []
    compilation.warnings = compilation.warnings || []

    const absForExclude = path.isAbsolute(res)
      ? res
      : path.join(
          manifestDir,
          isPublicRootLike(res) ? toPublicOutput(res) : res
        )

    if (/[*?\[\]{}]/.test(res)) {
      pushResource(matches, res)
      return
    }

    if (isPublicRootLike(res)) {
      const output = toPublicOutput(res)
      const publicAbs = path.join(projectPath, 'public', output)

      if (!fs.existsSync(publicAbs)) {
        const outputRoot =
          compilation.options?.output?.path ||
          compilation.outputOptions?.path ||
          path.join(path.dirname(manifestPath), 'dist')

        const overrideNotFoundPath = path.join(outputRoot || '', output)
        const msg = warMessages.warFieldError(publicAbs, {
          overrideNotFoundPath,
          publicRootHint: true
        })
        const err = new (WebpackError as unknown as {
          new (message: string): Error & {file?: string}
        })(msg)
        err.file = 'manifest.json'

        compilation.warnings!.push(err)
      }

      pushResource(matches, output)
      return
    }

    const abs = path.isAbsolute(res) ? res : path.join(manifestDir, res)
    if (!fs.existsSync(abs)) {
      // Warn about missing relative path using standardized message
      const msg = warMessages.warFieldError(abs)
      const warn = new WebpackError(msg) as Error & {
        file?: string
        name?: string
      }
      warn.file = 'manifest.json'
      warn.name = 'WARRelativeAssetMissing'
      compilation.warnings!.push(warn)

      pushResource(matches, res)
      return
    }

    const emitted = emitFileAsAsset(compilation, abs)
    pushResource(matches, emitted)
  }

  if (isV2) {
    war.forEach((res) => handleOne(undefined, res as string))
  } else {
    war.forEach((group) => {
      // @ts-expect-error - group is an object
      const matches = group.matches || []

      validateMatchesOrReport(compilation, matches, browser)

      // @ts-expect-error - group is an object
      group.resources.forEach((res) => handleOne(matches, res))
    })
  }

  return {v2, v3}
}
