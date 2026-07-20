//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  Compilation,
  type Compiler,
  DefinePlugin,
  ProvidePlugin,
  sources,
  WebpackError
} from '@rspack/core'
import * as dotenv from 'dotenv'
import {
  CHROMIUM_FAMILY_ALIASES,
  GECKO_FAMILY_ALIASES,
  isChromiumBasedBrowser,
  isGeckoBasedBrowser
} from '../lib/constants'
import {setCurrentManifestContent} from '../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import type {DevOptions, PluginInterface} from '../types'
import * as messages from './compilation-lib/messages'

function resolveProcessShim(): string | undefined {
  const candidate = path.join(__dirname, '..', 'runtime', 'process-shim.cjs')
  try {
    return fs.existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

function findNearestWorkspaceRoot(startDir: string): string | undefined {
  let current = path.isAbsolute(startDir)
    ? path.normalize(startDir)
    : path.resolve(startDir)
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

function resolveEnvPaths(projectPath: string, envFiles: string[]) {
  const localEnvPath =
    envFiles
      .map((file) => path.join(projectPath, file))
      .find((filePath) => fs.existsSync(filePath)) || ''
  const localDefaultsPath = path.join(projectPath, '.env.defaults')

  if (localEnvPath || fs.existsSync(localDefaultsPath)) {
    return {
      envPath: localEnvPath,
      defaultsPath: localDefaultsPath
    }
  }

  const workspaceRoot = findNearestWorkspaceRoot(projectPath)
  if (workspaceRoot && workspaceRoot !== projectPath) {
    const workspaceEnvPath =
      envFiles
        .map((file) => path.join(workspaceRoot, file))
        .find((filePath) => fs.existsSync(filePath)) || ''
    const workspaceDefaultsPath = path.join(workspaceRoot, '.env.defaults')

    if (workspaceEnvPath || fs.existsSync(workspaceDefaultsPath)) {
      return {
        envPath: workspaceEnvPath,
        defaultsPath: workspaceDefaultsPath
      }
    }
  }

  return {
    envPath: '',
    defaultsPath: localDefaultsPath
  }
}

// Env files resolve family-wide, mirroring the manifest-prefix contract; the
// exact browser name wins, Safari/webkit inherit the chromium family.
export function getEnvFileCandidates(
  browser: DevOptions['browser'],
  mode: string
): string[] {
  const browserName = String(browser)
  const isChromiumTarget =
    isChromiumBasedBrowser(browserName) ||
    browserName === 'safari' ||
    browserName.includes('webkit')

  const familyNames = isChromiumTarget
    ? CHROMIUM_FAMILY_ALIASES
    : isGeckoBasedBrowser(browserName)
      ? GECKO_FAMILY_ALIASES
      : []
  const names = [
    browserName,
    ...familyNames.filter((name) => name !== browserName)
  ]

  return [
    ...names.flatMap((name) => [`.env.${name}.${mode}`, `.env.${name}`]),
    `.env.${mode}`,
    '.env.local',
    '.env'
  ]
}

export class EnvPlugin {
  public readonly browser: DevOptions['browser']
  public readonly manifestPath?: string

  constructor(options: Partial<PluginInterface>) {
    this.browser = options.browser || 'chrome'
    this.manifestPath = options.manifestPath
  }

  apply(compiler: Compiler) {
    const projectPath =
      (compiler.options.context as string) ||
      (this.manifestPath ? path.dirname(this.manifestPath) : '')
    const mode = compiler.options.mode || 'development'

    // Collect .env files by browser (family-wide) and mode. .env.example is
    // intentionally NOT included: placeholder values, never a real source.
    const envFiles = getEnvFileCandidates(this.browser, mode)

    const {envPath, defaultsPath} = resolveEnvPaths(projectPath, envFiles)

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.envSelectedFile(envPath))
    }

    // The project ships .env files but none match this browser/mode; every
    // EXTENSION_PUBLIC_* read would be undefined, so surface a build warning.
    if (!envPath && projectPath) {
      let unmatchedEnvFiles: string[] = []
      try {
        unmatchedEnvFiles = fs
          .readdirSync(projectPath)
          .filter(
            (file) =>
              file.startsWith('.env') &&
              file !== '.env.defaults' &&
              file !== '.env.example'
          )
          .sort()
      } catch {
        // unreadable project dir, nothing to warn about
      }

      if (unmatchedEnvFiles.length > 0) {
        compiler.hooks.thisCompilation.tap(
          'env:warn-unmatched',
          (compilation) => {
            const warn = new WebpackError(
              messages.envNoMatchingFile(
                String(this.browser),
                String(mode),
                unmatchedEnvFiles,
                envFiles
              )
            ) as Error & {file?: string; name?: string}
            warn.name = 'EnvNoMatchingFile'
            compilation.warnings.push(warn)
          }
        )
      }
    }

    // dotenv.parse (not .config) on purpose: .config mutates process.env, which
    // wins the merge, so the first build's values would leak into later builds.
    const envVars = envPath ? dotenv.parse(fs.readFileSync(envPath)) : {}
    const defaultsVars = fs.existsSync(defaultsPath)
      ? dotenv.parse(fs.readFileSync(defaultsPath))
      : {}

    const combinedVars = {
      ...defaultsVars,
      ...envVars,
      ...process.env
    }

    const filteredEnvVars = Object.keys(combinedVars)
      .filter((key) => key.startsWith('EXTENSION_PUBLIC_'))
      .reduce(
        (obj, key) => {
          obj[`process.env.${key}`] = JSON.stringify(combinedVars[key])
          obj[`import.meta.env.${key}`] = JSON.stringify(combinedVars[key])
          return obj
        },
        {} as Record<string, string>
      )

    filteredEnvVars['process.env.EXTENSION_PUBLIC_BROWSER'] = JSON.stringify(
      this.browser
    )
    filteredEnvVars['import.meta.env.EXTENSION_PUBLIC_BROWSER'] =
      JSON.stringify(this.browser)
    filteredEnvVars['process.env.EXTENSION_PUBLIC_MODE'] = JSON.stringify(mode)
    filteredEnvVars['import.meta.env.EXTENSION_PUBLIC_MODE'] =
      JSON.stringify(mode)
    filteredEnvVars['process.env.EXTENSION_BROWSER'] = JSON.stringify(
      this.browser
    )
    filteredEnvVars['import.meta.env.EXTENSION_BROWSER'] = JSON.stringify(
      this.browser
    )
    filteredEnvVars['process.env.EXTENSION_MODE'] = JSON.stringify(mode)
    filteredEnvVars['import.meta.env.EXTENSION_MODE'] = JSON.stringify(mode)

    filteredEnvVars['process.env.BROWSER'] = JSON.stringify(this.browser)
    filteredEnvVars['import.meta.env.BROWSER'] = JSON.stringify(this.browser)
    filteredEnvVars['process.env.MODE'] = JSON.stringify(mode)
    filteredEnvVars['import.meta.env.MODE'] = JSON.stringify(mode)

    // Define bare import.meta.env as an object of every injected var (Vite
    // parity); otherwise rspack rewrites it to (void 0) and reads crash at boot.
    const importMetaEnvObject: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(filteredEnvVars)) {
      if (key.startsWith('import.meta.env.')) {
        importMetaEnvObject[key.slice('import.meta.env.'.length)] =
          JSON.parse(value)
      }
    }
    filteredEnvVars['import.meta.env'] = JSON.stringify(importMetaEnvObject)

    // Neutralize Node-only import.meta.dirname/filename: vendored ESM runtimes
    // reference them in dead branches that otherwise fail classic-chunk minification.
    filteredEnvVars['import.meta.dirname'] = 'undefined'
    filteredEnvVars['import.meta.filename'] = 'undefined'

    const injectedCount = Object.keys(filteredEnvVars).filter((k) =>
      k.startsWith('process.env.EXTENSION_PUBLIC_')
    ).length

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.envInjectedPublicVars(injectedCount))
    }

    // Provide a real browser process object so free process.* reads don't throw;
    // EXTENSION_PUBLIC_* reads are still statically inlined and tree-shakeable.
    const processShim = resolveProcessShim()

    if (!processShim) {
      // Fallback (shim missing from the install): merge a minimal-but-complete
      // stub into the single DefinePlugin so bundled `process` access is safe.
      filteredEnvVars['process.env'] = '{}'
      filteredEnvVars.process =
        '({env:{},argv:[],platform:"browser",browser:true,versions:{},nextTick:function(cb){Promise.resolve().then(function(){cb()})}})'
    }

    new DefinePlugin(filteredEnvVars).apply(compiler)

    if (processShim) {
      new ProvidePlugin({process: processShim}).apply(compiler)
    }

    compiler.hooks.thisCompilation.tap(
      'manifest:update-manifest',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'env:module',
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          (assets) => {
            // Prefer compilation assets to be robust against different bundler versions
            const files = Object.keys(compilation.assets || assets)

            files.forEach((filename) => {
              if (filename.endsWith('.json') || filename.endsWith('.html')) {
                let fileContent = String(
                  compilation.assets[filename]?.source() ?? ''
                )

                const resolveVar = (name: string): string => {
                  // Prefer system > explicit env file > defaults; preserve when missing
                  if (Object.prototype.hasOwnProperty.call(process.env, name)) {
                    const systemValue = process.env[name]
                    if (typeof systemValue === 'string') return systemValue
                  }

                  if (Object.prototype.hasOwnProperty.call(envVars, name)) {
                    const explicitEnvValue = (
                      envVars as Record<string, string | undefined>
                    )[name]
                    if (typeof explicitEnvValue === 'string')
                      return explicitEnvValue
                  }

                  if (
                    Object.prototype.hasOwnProperty.call(defaultsVars, name)
                  ) {
                    const defaultsValue = (
                      defaultsVars as Record<string, string | undefined>
                    )[name]
                    if (typeof defaultsValue === 'string') return defaultsValue
                  }
                  const combinedValue = (
                    combinedVars as Record<string, unknown>
                  )[name]

                  return typeof combinedValue === 'string'
                    ? combinedValue
                    : `$${name}`
                }

                fileContent = fileContent.replace(
                  /\$EXTENSION_PUBLIC_[A-Z_]+/g,
                  (match: string) => {
                    const envVarName = match.slice(1)
                    return resolveVar(envVarName)
                  }
                )

                fileContent = fileContent.replace(
                  /\$EXTENSION_[A-Z_]+/g,
                  (match: string) => {
                    const envVarName = match.slice(1)
                    return resolveVar(envVarName)
                  }
                )

                compilation.updateAsset(
                  filename,
                  new sources.RawSource(fileContent)
                )

                if (filename === 'manifest.json') {
                  setCurrentManifestContent(compilation, fileContent)
                }
              }
            })
          }
        )
      }
    )
  }
}
