// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import * as vm from 'node:vm'
import type {Configuration} from '@rspack/core'
import dotenv from 'dotenv'
import type {BrowserConfig, DevOptions, FileConfig} from '../types'
import {isWebkitBasedBrowser} from './constants'
import * as messages from './messages'
import {isDebug} from './messaging'
import type {ParsedJson} from './parse-json-safe'

type EnvPreloadResult = {
  loadedAny: boolean
  envDir: string
}

// Keys this module introduced into process.env by loading a dotenv file, as
// opposed to keys the shell or CI really set. dotenv.config mutates
// process.env, and the compilation merge treats process.env as the highest
// precedence layer, so without this record a preloaded .env.defaults value
// would outrank the .env.<browser> file that is supposed to override it.
const preloadedEnvKeys = new Set<string>()

export function getPreloadedEnvKeys(): ReadonlySet<string> {
  return preloadedEnvKeys
}

function recordPreloadedKeys(filePath: string): void {
  try {
    for (const key of Object.keys(dotenv.parse(fs.readFileSync(filePath)))) {
      // Already present means the shell owns it: dotenv.config leaves those
      // alone (override is off), so it stays a genuine environment value.
      if (!(key in process.env)) preloadedEnvKeys.add(key)
    }
  } catch {
    // Ignore
  }
}

function loadCommonJsConfigWithStableDirname(absolutePath: string) {
  const code = fs.readFileSync(absolutePath, 'utf-8')
  const dirname = path.dirname(absolutePath)
  const requireFn = createRequire(absolutePath)

  // Emulate Node's CJS wrapper so __filename/__dirname match the real file,
  // avoiding the temp-.cjs copy that broke __dirname-relative configs.
  const module = {exports: {} as ParsedJson}
  const exports = module.exports

  const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${code}\n})`
  const fn = new vm.Script(wrapped, {
    filename: absolutePath
  }).runInThisContext()

  fn(exports, requireFn, module, absolutePath, dirname)
  return module.exports?.default || module.exports
}

function findNearestWorkspaceRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir)
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

function preloadEnvFilesFromDir(
  envDir: string,
  options?: {
    override?: boolean
  }
): EnvPreloadResult {
  let loadedAny = false
  try {
    const defaultsPath = path.join(envDir, '.env.defaults')
    if (fs.existsSync(defaultsPath)) {
      recordPreloadedKeys(defaultsPath)
      dotenv.config({
        path: defaultsPath,
        override: Boolean(options?.override),
        quiet: true
      })
      loadedAny = true
    }

    const envCandidates = ['.env.development', '.env.local', '.env']

    for (const filename of envCandidates) {
      const filePath = path.join(envDir, filename)
      if (fs.existsSync(filePath)) {
        recordPreloadedKeys(filePath)
        dotenv.config({
          path: filePath,
          override: Boolean(options?.override),
          quiet: true
        })
        loadedAny = true
        break
      }
    }
  } catch {
    // Ignore
  }
  return {loadedAny, envDir}
}

function findConfigFile(projectPath: string): string | undefined {
  const candidates = [
    path.join(projectPath, 'extension.config.js'),
    path.join(projectPath, 'extension.config.mjs'),
    path.join(projectPath, 'extension.config.cjs')
  ]
  return candidates.find((p) => fs.existsSync(p))
}

function preloadEnvFiles(projectDir: string) {
  const local = preloadEnvFilesFromDir(projectDir)
  if (local.loadedAny) return local

  const workspaceRoot = findNearestWorkspaceRoot(projectDir)
  if (workspaceRoot && workspaceRoot !== projectDir) {
    return preloadEnvFilesFromDir(workspaceRoot)
  }

  return local
}

const loadedConfigCache = new Map<string, Promise<FileConfig>>()

async function loadConfigFile(configPath: string): Promise<FileConfig> {
  const absolutePath = path.resolve(configPath)

  const cached = loadedConfigCache.get(absolutePath)
  if (cached) return cached

  const loading = loadConfigFileUncached(absolutePath)
  loadedConfigCache.set(absolutePath, loading)

  try {
    return await loading
  } catch (error) {
    // Don't poison the cache with a transient failure.
    loadedConfigCache.delete(absolutePath)
    throw error
  }
}

async function loadConfigFileUncached(
  absolutePath: string
): Promise<FileConfig> {
  const projectDir = path.dirname(absolutePath)

  preloadEnvFiles(projectDir)

  try {
    if (absolutePath.endsWith('.cjs')) {
      const requireFn = createRequire(import.meta.url)
      const required = requireFn(absolutePath)
      return required?.default || required
    }

    let esmImportPath = absolutePath
    // Tracks a temp dir holding the env-shimmed copy so we can delete it right
    // after import, the serialized environment must not linger on disk.
    let shimTmpDir: string | undefined

    try {
      const originalContent = fs.readFileSync(absolutePath, 'utf-8')

      if (originalContent.includes('import.meta.env')) {
        shimTmpDir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'extension-config-esm-')
        )
        const tmpPath = path.join(shimTmpDir, path.basename(absolutePath))

        const envObjectLiteral = JSON.stringify(
          Object.fromEntries(
            Object.entries(process.env).map(([k, v]) => [k, v])
          ),
          null,
          0
        )
        const shimHeader = `const __IMPORT_META_ENV__ = Object.freeze(${envObjectLiteral});\n`
        const replaced = originalContent.replace(
          /import\.meta\.env/g,
          '__IMPORT_META_ENV__'
        )
        fs.writeFileSync(tmpPath, `${shimHeader}${replaced}`, 'utf-8')
        esmImportPath = tmpPath
      }
    } catch {
      // Ignore
    }

    try {
      const module = await import(pathToFileURL(esmImportPath).href)
      return module.default || module
    } finally {
      if (shimTmpDir) {
        try {
          fs.rmSync(shimTmpDir, {recursive: true, force: true})
        } catch {
          // Ignore
        }
      }
    }
  } catch (err: unknown) {
    const error = err as Error
    try {
      if (!absolutePath.endsWith('.mjs')) {
        const requireFn = createRequire(import.meta.url)
        let required: ParsedJson

        try {
          required = requireFn(absolutePath)
        } catch (requireErr) {
          // If Node refuses to require a CJS-content .js file (package.json "type":
          // "module"), copy to a temporary .cjs and require that instead.
          const message =
            String(error?.message || '') +
            ' ' +
            String((requireErr as Error | undefined)?.message || '')
          const looksLikeCommonJsInEsm =
            message.includes('require is not defined in ES module scope') ||
            message.includes('Cannot use import statement outside a module') ||
            message.includes('ERR_REQUIRE_ESM')

          if (looksLikeCommonJsInEsm) {
            try {
              required = loadCommonJsConfigWithStableDirname(absolutePath)
            } catch {
              // Fallback: legacy behavior (temp copy + require). This may break __dirname,
              // but keeps compatibility for edge cases where vm evaluation fails.
              const tmpDir = fs.mkdtempSync(
                path.join(os.tmpdir(), 'extension-config-')
              )
              try {
                const tmpCjsPath = path.join(
                  tmpDir,
                  path.basename(absolutePath, path.extname(absolutePath)) +
                    '.cjs'
                )
                fs.copyFileSync(absolutePath, tmpCjsPath)
                required = requireFn(tmpCjsPath)
              } finally {
                try {
                  fs.rmSync(tmpDir, {recursive: true, force: true})
                } catch {
                  // Ignore
                }
              }
            }
          } else {
            throw requireErr
          }
        }
        return required?.default || required
      }
    } catch {
      // Ignore
    }

    try {
      const content = fs.readFileSync(absolutePath, 'utf-8')
      return JSON.parse(content)
    } catch (jsonErr: unknown) {
      throw new Error(
        `Failed to load config file: ${absolutePath}\nError: ${error.message || error}`
      )
    }
  }
}

export async function loadCustomConfig(projectPath: string) {
  const configPath = findConfigFile(projectPath)

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(configPath)
        if (userConfig && typeof userConfig.config === 'function') {
          return userConfig.config
        }
        if (userConfig?.config && typeof userConfig.config === 'object') {
          const partial = userConfig.config as Configuration
          return (config: Configuration) => {
            // NOTE: Keep `webpack-merge` out of the module top-level imports so
            // preview/run-only paths can load config logic without pulling it in.
            const requireFn = createRequire(import.meta.url)
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const {merge} = requireFn(
              'webpack-merge'
            ) as typeof import('webpack-merge')
            return merge(config, partial)
          }
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(messages.configLoadingError(configPath, error))
        throw err
      }
    }
  }

  return (config: Configuration) => config
}

export async function loadCommandConfig(
  projectPath: string,
  command: 'dev' | 'build' | 'start' | 'preview'
) {
  const configPath = findConfigFile(projectPath)

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(configPath)
        // Allow top-level `extensions`/`transpilePackages`/`perfBudgets` keys
        // to apply to all commands, with per-command overrides via
        // `commands.<cmd>.*`.
        const configExtras = userConfig as
          | Pick<FileConfig, 'extensions' | 'transpilePackages' | 'perfBudgets'>
          | undefined
        const baseExtensions =
          configExtras && configExtras.extensions
            ? {extensions: configExtras.extensions}
            : {}
        const baseTranspilePackages =
          configExtras && Array.isArray(configExtras.transpilePackages)
            ? {transpilePackages: configExtras.transpilePackages}
            : {}
        const basePerfBudgets =
          configExtras &&
          configExtras.perfBudgets &&
          typeof configExtras.perfBudgets === 'object'
            ? {perfBudgets: configExtras.perfBudgets}
            : {}
        const perCommand = userConfig?.commands?.[command]
          ? userConfig.commands[command]
          : {}
        return {
          ...baseExtensions,
          ...baseTranspilePackages,
          ...basePerfBudgets,
          ...perCommand
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(messages.configLoadingError(configPath, error))
        throw err
      }
    }
  }

  return {}
}

export async function loadBrowserConfig(
  projectPath: string,
  browser: DevOptions['browser'] = 'chrome'
): Promise<BrowserConfig> {
  const configPath = findConfigFile(projectPath)

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(configPath)
        if (userConfig?.browser) {
          const browsers = userConfig.browser as Record<string, BrowserConfig>

          const browserName = String(browser)

          // 'chromium'/'firefox'/'safari' = managed or named product; must not adopt
          // engine-based configs that expect an explicit binary. '*-based' and any
          // webkit-flavored fork name may fall back to the product/engine block.
          if (browser === 'chromium-based') {
            if (browsers['chromium-based']) return browsers['chromium-based']
            if (browsers.chromium) return browsers.chromium
          } else if (browser === 'gecko-based') {
            if (browsers['gecko-based']) return browsers['gecko-based']
            if (browsers.firefox) return browsers.firefox
          } else if (isWebkitBasedBrowser(browserName)) {
            // Exact name first (safari, webkit-based, or a fork like acme-webkit),
            // then the engine block, then the safari product block. Named product
            // 'safari' stops at its own block and does not adopt webkit-based.
            const direct = browsers[browserName]
            if (direct) return direct
            if (browserName !== 'safari') {
              if (browsers['webkit-based']) return browsers['webkit-based']
              if (browsers.safari) return browsers.safari
            }
          } else {
            const direct = browsers[browserName]
            if (direct) return direct
          }
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(messages.configLoadingError(configPath, error))
        throw err
      }
    }
  }

  return {
    browser: browser || 'chrome'
  }
}

let userMessageDelivered = false

export async function isUsingExperimentalConfig(projectPath: string) {
  const configPath = findConfigFile(projectPath)

  if (configPath) {
    if (!userMessageDelivered) {
      if (isDebug()) {
        console.log(messages.isUsingExperimentalConfig('extension.config.js'))
      }
      userMessageDelivered = true
    }
    return true
  }
  return false
}
