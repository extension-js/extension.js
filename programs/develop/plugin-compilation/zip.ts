//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import AdmZip from 'adm-zip'
import ignore from 'ignore'
import glob from 'tiny-glob'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'
import {parseJsonSafe} from '../lib/parse-json-safe'
import type {DevOptions} from '../types'
import {recordZipArtifact} from './zip-artifacts'

export interface ZipPluginOptions {
  manifestPath?: string
  browser: DevOptions['browser']
  zipData?: {
    zip?: boolean
    zipSource?: boolean
    zipFilename?: string
  }
}

function sanitize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
}

// An explicit --zip-filename is honored as typed: only path separators,
// reserved characters and trailing dots are stripped, never dashes or case.
function explicitZipFilename(input: string): string {
  const flat = path.basename(input.trim())
  const safe = flat
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\.+$/, '')
    .trim()
  if (!safe) return 'extension.zip'
  return /\.zip$/i.test(safe) ? safe : `${safe}.zip`
}

// Resolve an i18n manifest name (__MSG_appName__) against the default locale's
// messages.json so the zip carries the real name; falls back to dir basename.
function resolveManifestName(
  rawName: unknown,
  manifest: {default_locale?: unknown},
  searchRoots: string[],
  fallback: string
): string {
  const raw = typeof rawName === 'string' ? rawName : ''
  const msgMatch = raw.match(/^__MSG_(.+)__$/)
  if (!msgMatch) return raw || fallback

  const locale = String(manifest.default_locale || 'en')
  for (const root of searchRoots) {
    try {
      const messagesPath = path.join(root, '_locales', locale, 'messages.json')
      const parsed = parseJsonSafe(fs.readFileSync(messagesPath, 'utf-8'))
      const message = parsed?.[msgMatch[1]]?.message
      if (typeof message === 'string' && message.trim()) return message
    } catch {
      // Ignore
    }
  }
  return fallback
}

const toPosix = (p: string): string => p.replace(/\\/g, '/')

// Companion extensions under ./extensions are loaded beside yours for local
// debugging and are somebody else's code, so they are never part of your
// source. Relying on .gitignore to keep them out is not enough: the ignore
// file is written by whatever placed the companion, it is absent in a project
// that is not a repository, and a source zip is published. A companion that
// carries broad host permissions would otherwise ship inside a release
// someone downloads and trusts.
const COMPANION_DIR = 'extensions'

function isCompanionExtension(file: string): boolean {
  const [first] = toPosix(file).split('/')
  return first === COMPANION_DIR
}

// The source zip is the artifact the share feature hands to strangers, so
// exclusion cannot depend on the user having written a correct .gitignore.
// This deny list is the security boundary; the root .gitignore is only a
// courtesy supplement on top of it. `.git` also matches the worktree case
// where `.git` is a file, and matching any path segment covers nested
// repositories and nested node_modules too.
const DENIED_SEGMENTS = new Set(['.git', '.extension-js', 'node_modules'])

// dist/extension-js holds managed browser profiles (cookies, logins) and
// session logs. Its '*' self-ignore is invisible to a root-only scan.
const SESSION_ARTIFACTS_PREFIX = 'dist/extension-js'

// Env files hold the secrets the framework itself tells users to put there
// (config-loader and EnvPlugin load .env, .env.development, .env.local).
// Only the shareable *.example variants may ship.
function isDeniedEnvFile(basename: string): boolean {
  if (!basename.startsWith('.env')) return false
  return !basename.endsWith('.example')
}

export function isDeniedFromSourceZip(file: string): boolean {
  const posix = toPosix(file)
  const segments = posix.split('/')
  if (segments.some((segment) => DENIED_SEGMENTS.has(segment))) return true
  if (isDeniedEnvFile(segments[segments.length - 1])) return true
  return (
    posix === SESSION_ARTIFACTS_PREFIX ||
    posix.startsWith(`${SESSION_ARTIFACTS_PREFIX}/`)
  )
}

export async function getFilesToZip(projectDir: string): Promise<string[]> {
  const gitignorePath = path.join(projectDir, '.gitignore')
  const ig = ignore()

  try {
    const content = fs.readFileSync(gitignorePath, 'utf8')
    if (content) ig.add(content)
  } catch {
    // Ignore: the deny list stays the boundary, a project without a
    // readable .gitignore only loses its own extra exclusions.
  }

  // filesOnly drops directory entries (adm-zip tolerated them but the zip
  // carried noise) and flush bypasses tiny-glob's module-global cache,
  // which would go stale in a long-lived watch process.
  const files = await glob('**/*', {
    cwd: projectDir,
    dot: true,
    filesOnly: true,
    flush: true
  })
  return files.filter(
    (file) =>
      !isDeniedFromSourceZip(file) &&
      !ig.ignores(file) &&
      !isCompanionExtension(file)
  )
}

export class ZipPlugin {
  private readonly browser: DevOptions['browser']
  private readonly zipData: {
    zip?: boolean
    zipSource?: boolean
    zipFilename?: string
  }

  constructor(private readonly options: ZipPluginOptions) {
    this.browser = this.options.browser || 'chrome'
    this.zipData = this.options.zipData ?? {}
  }

  apply(compiler: Compiler) {
    compiler.hooks.done.tapPromise('plugin-zip', async (stats) => {
      if (!(this.zipData.zip || this.zipData.zipSource)) return

      try {
        const created: Array<{kind: 'source' | 'dist'; path: string}> = []
        // Try to read manifest name/version from output (dist)
        // Use output.path for outDir instead of assuming dist/browser
        const outPath = compiler.options.output?.path as string
        const packageJsonDir = compiler.options.context as string

        const manifestPath = this.options.manifestPath
          ? this.options.manifestPath
          : path.join(
              this.zipData.zipSource ? packageJsonDir : outPath,
              'manifest.json'
            )

        const manifest = parseJsonSafe(fs.readFileSync(manifestPath, 'utf-8'))

        // A missing default-locale folder makes the zip store-rejectable, and
        // the ADM-ZIP failure that follows hides the root cause; warn up front.
        if (manifest.default_locale) {
          const localeRoot = this.zipData.zipSource ? packageJsonDir : outPath
          const messagesPath = path.join(
            localeRoot,
            '_locales',
            String(manifest.default_locale),
            'messages.json'
          )
          if (!fs.existsSync(messagesPath)) {
            stats?.compilation?.warnings?.push(
              new Error(
                `ZipPlugin: manifest.json declares default_locale "${String(
                  manifest.default_locale
                )}" but ${messagesPath} does not exist. Stores reject packages ` +
                  `without their default locale: restore the _locales folder ` +
                  `before shipping this zip.`
              ) as (typeof stats.compilation.warnings)[number]
            )
          }
        }

        const base = sanitize(
          resolveManifestName(
            manifest.name,
            manifest,
            [outPath, path.dirname(manifestPath), packageJsonDir],
            path.basename(packageJsonDir)
          )
        )
        const name = `${base}-${manifest.version || '0.0.0'}`

        if (this.zipData.zipSource) {
          const sourceZip = new AdmZip()
          const files = await getFilesToZip(packageJsonDir)
          files.forEach((file) => {
            const root = path.dirname(file)
            sourceZip.addLocalFile(
              path.join(packageJsonDir, file),
              root === '.' ? '' : toPosix(root)
            )
          })

          const sourcePath = path.join(
            path.dirname(outPath),
            `${name}-source.zip`
          )
          if (isDebug()) {
            console.log(messages.packagingSourceFiles(sourcePath))
          }

          sourceZip.writeZip(sourcePath)
          created.push({kind: 'source', path: sourcePath})
        }

        if (this.zipData.zip) {
          const distZip = new AdmZip()
          distZip.addLocalFolder(outPath)
          const zipName = this.zipData.zipFilename
            ? explicitZipFilename(this.zipData.zipFilename)
            : `${name}.zip`
          const distPath = path.join(outPath, zipName)

          if (isDebug()) {
            console.log(messages.packagingDistributionFiles(distPath))
          }
          distZip.writeZip(distPath)
          created.push({kind: 'dist', path: distPath})
        }
        for (const artifact of created) {
          let size = 0
          try {
            size = fs.statSync(artifact.path).size
          } catch {
            // Ignore
          }
          recordZipArtifact(stats?.compilation, {
            kind: artifact.kind,
            path: artifact.path,
            size
          })
        }
        if (isDebug()) {
          const sourceItem = created.find((c) => c.kind === 'source')
          const distItem = created.find((c) => c.kind === 'dist')

          if (sourceItem && distItem) {
            console.log(
              messages.treeWithSourceAndDistFiles(
                this.browser,
                name,
                sourceItem.path,
                distItem.path
              )
            )
          } else if (sourceItem) {
            console.log(
              messages.treeWithSourceFiles(
                name,
                'zip',
                this.browser,
                sourceItem.path
              )
            )
          } else if (distItem) {
            console.log(
              messages.treeWithDistFilesBrowser(
                name,
                'zip',
                this.browser,
                distItem.path
              )
            )
          }
        }
      } catch (error) {
        // Surface error in build output but do not crash dev builds
        if (stats?.compilation?.warnings) {
          stats.compilation.warnings.push(
            new Error(`ZipPlugin: Failed to create zip(s): ${String(error)}`)
          )
        }
      }
    })
  }
}
