// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire, register as registerModuleHooks} from 'node:module'
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
import {resolveProjectStructureSync} from './project'

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

// Env files from weakest to strongest: defaults only fill gaps, the base
// file applies, a local override file layers on top, and the mode file wins
// among files. A key the shell already owns is never touched by any of them.
const ENV_PRELOAD_ORDER = [
  '.env.defaults',
  '.env',
  '.env.local',
  '.env.development'
]

function applyEnvFile(filePath: string, shellOwned: ReadonlySet<string>) {
  const parsed = dotenv.parse(fs.readFileSync(filePath))

  for (const [key, value] of Object.entries(parsed)) {
    if (shellOwned.has(key)) continue

    process.env[key] = value
    preloadedEnvKeys.add(key)
  }
}

// `exports.default || exports` hid a falsy default export behind the module
// namespace, so `export default null` read as a valid config object.
function unwrapDefaultExport(loaded: unknown): unknown {
  if (loaded && typeof loaded === 'object' && 'default' in loaded) {
    return (loaded as {default: unknown}).default
  }

  return loaded
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

  return unwrapDefaultExport(module.exports)
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

function preloadEnvFilesFromDir(envDir: string): EnvPreloadResult {
  let loadedAny = false
  // Snapshot before any file loads: a later, stronger file may override an
  // earlier file's value but never a value the shell or CI exported.
  const shellOwned = new Set(
    Object.keys(process.env).filter((key) => !preloadedEnvKeys.has(key))
  )

  for (const filename of ENV_PRELOAD_ORDER) {
    const filePath = path.join(envDir, filename)
    if (!fs.existsSync(filePath)) continue

    try {
      applyEnvFile(filePath, shellOwned)
      loadedAny = true
    } catch {
      // Ignore
    }
  }

  return {loadedAny, envDir}
}

const PROJECT_CONFIG_FILENAMES = [
  'extension.config.js',
  'extension.config.mjs',
  'extension.config.cjs'
]

function configCandidatesIn(dir: string): string[] {
  return PROJECT_CONFIG_FILENAMES.map((name) => path.join(dir, name))
}

function findConfigFileIn(dir: string): string | undefined {
  return configCandidatesIn(dir).find((p) => fs.existsSync(p))
}

function resolveManifestDir(projectPath: string): string | undefined {
  // A remote URL or a folder that is not there yet has no manifest on disk,
  // and the walk would otherwise read the working directory's ancestry.
  try {
    if (!fs.statSync(projectPath).isDirectory()) return undefined
  } catch {
    return undefined
  }

  try {
    const structure = resolveProjectStructureSync(projectPath, {quiet: true})

    return path.dirname(structure.manifestPath)
  } catch {
    return undefined
  }
}

// The package root is where the config belongs and is looked at first, but
// dev also accepts the manifest folder as the project, and a config kept
// beside the manifest used to be ignored without a word.
export function findConfigFile(projectPath: string): string | undefined {
  const atRoot = findConfigFileIn(projectPath)
  if (atRoot) return atRoot

  const manifestDir = resolveManifestDir(projectPath)

  if (!manifestDir || path.resolve(manifestDir) === path.resolve(projectPath)) {
    return undefined
  }

  return findConfigFileIn(manifestDir)
}

// Every path findConfigFile would accept, present or not. A watcher needs the
// absent ones too, so a config added mid-session is noticed as a change.
export function projectConfigCandidatePaths(projectPath: string): string[] {
  const dirs = [projectPath]
  const manifestDir = resolveManifestDir(projectPath)

  if (manifestDir && path.resolve(manifestDir) !== path.resolve(projectPath)) {
    dirs.push(manifestDir)
  }

  return dirs.flatMap((dir) => configCandidatesIn(dir))
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

// import.meta.env is not a Node property, so a config that reads it needs the
// source rewritten. A loader hook does that while keeping the file's own URL,
// which is what makes relative imports and import.meta.dirname stay correct.
const IMPORT_META_ENV_GLOBAL = '__EXTENSION_IMPORT_META_ENV__'
const IMPORT_META_ENV_HOOK = `
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const CONFIG_FILE = /(^|\\/)extension\\.config\\.(js|mjs)$/

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !CONFIG_FILE.test(new URL(url).pathname)) {
    return nextLoad(url, context)
  }

  let text

  try {
    text = readFileSync(fileURLToPath(url), 'utf8')
  } catch {
    return nextLoad(url, context)
  }

  if (!text.includes('import.meta.env')) return nextLoad(url, context)

  // import.meta is module syntax, so the format is settled here. Left to
  // Node, a package.json without "type" means a reparse and a warning per run.
  const loaded = await nextLoad(url, {...context, format: 'module'})
  const source =
    typeof loaded.source === 'string'
      ? loaded.source
      : Buffer.from(loaded.source).toString('utf8')

  return {
    ...loaded,
    source: source.replaceAll(
      'import.meta.env',
      'globalThis.${IMPORT_META_ENV_GLOBAL}'
    )
  }
}
`

let importMetaEnvHookRegistered = false

function prepareImportMetaEnv(absolutePath: string): void {
  let source = ''

  try {
    source = fs.readFileSync(absolutePath, 'utf-8')
  } catch {
    return
  }

  if (!source.includes('import.meta.env')) {
    return // Read at import time, after the dotenv preload, and held in memory only.
    // The previous shim serialized every variable into a file under os.tmpdir().
  }

  ;(globalThis as Record<string, unknown>)[IMPORT_META_ENV_GLOBAL] =
    Object.freeze({...process.env})

  if (importMetaEnvHookRegistered) return

  try {
    registerModuleHooks(
      `data:text/javascript,${encodeURIComponent(IMPORT_META_ENV_HOOK)}`
    )

    importMetaEnvHookRegistered = true
  } catch {
    // Ignore: the import below still runs, and a config reading
    // import.meta.env fails with its own error rather than a temp path.
  }
}

class ConfigShapeError extends Error {}

const loadedConfigCache = new Map<string, Promise<FileConfig>>()

// Four loaders each report before rethrowing, so one bad config printed the
// same frame once per entry point. The command-level handler prints the reason.
const reportedConfigPaths = new Set<string>()

export function reportConfigLoadingErrorOnce(
  configPath: string,
  error: unknown
): void {
  // A wrong shape is a finished message the command prints itself, and the
  // file did load, so the "couldn't load" frame would say it a second time.
  if (error instanceof ConfigShapeError) return

  const key = path.resolve(configPath)
  if (reportedConfigPaths.has(key)) return

  reportedConfigPaths.add(key)
  // eslint-disable-next-line no-console
  console.error(messages.configLoadingError(configPath, error))
}

// The keys the loaders really read. A typo like `brower` used to build clean.
const CONFIG_TOP_LEVEL_KEYS = [
  'browser',
  'commands',
  'config',
  'configResolved',
  'define',
  'extensions',
  'folders',
  'perfBudgets',
  'transpilePackages'
] as const

// A config file is a plain object. A function default export is the webpack
// habit, and taking it silently meant nothing the author wrote applied.
function assertConfigShape(configPath: string, value: unknown): void {
  if (value === undefined) return

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigShapeError(messages.configWrongShape(configPath, value))
  }

  const unknown = Object.keys(value).filter(
    (key) => !(CONFIG_TOP_LEVEL_KEYS as readonly string[]).includes(key)
  )

  if (unknown.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      messages.configUnknownKeys(configPath, unknown, CONFIG_TOP_LEVEL_KEYS)
    )
  }
}

async function loadConfigFile(configPath: string): Promise<FileConfig> {
  const absolutePath = path.resolve(configPath)

  const cached = loadedConfigCache.get(absolutePath)
  if (cached) return cached

  const loading = loadConfigFileUncached(absolutePath).then((value) => {
    assertConfigShape(absolutePath, value)

    return value
  })
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

      return unwrapDefaultExport(required) as FileConfig
    }

    // The config is imported from its real path so relative imports resolve
    // and import.meta.dirname is the project, which a temp copy both broke.
    prepareImportMetaEnv(absolutePath)

    const module = await import(pathToFileURL(absolutePath).href)

    return unwrapDefaultExport(module) as FileConfig
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

        return unwrapDefaultExport(required) as FileConfig
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
        reportConfigLoadingErrorOnce(configPath, error)

        throw err
      }
    }
  }

  return (config: Configuration) => config
}

// The late hook: the bundler config with every loader rule attached, right
// before the first build. Absent when the config file has none.
export async function loadConfigResolvedHook(
  projectPath: string
): Promise<FileConfig['configResolved'] | undefined> {
  const configPath = findConfigFile(projectPath)
  if (!configPath) return undefined
  if (!(await isUsingExperimentalConfig(projectPath))) return undefined

  const userConfig = await loadConfigFile(configPath)

  return typeof userConfig?.configResolved === 'function'
    ? userConfig.configResolved
    : undefined
}

// A `define` value's declared type, so the generated ambient constant tells
// the author what the bundle will hold. A key set differently per browser or
// per command gets the union of its shapes.
function typeOfDefineValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'unknown[]'

  switch (typeof value) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'Record<string, unknown>'
    default:
      return 'unknown'
  }
}

function collectDefineTypes(
  into: Map<string, Set<string>>,
  define: unknown
): void {
  if (!define || typeof define !== 'object') return

  for (const [key, value] of Object.entries(
    define as Record<string, unknown>
  )) {
    const types = into.get(key) || new Set<string>()
    types.add(typeOfDefineValue(value))
    into.set(key, types)
  }
}

// Every `define` key the config file declares, at the top level and under
// each browser and command, with the type its values resolve to.
export async function loadDefineTypes(
  projectPath: string
): Promise<Record<string, string>> {
  const configPath = findConfigFile(projectPath)
  if (!configPath) return {}
  if (!(await isUsingExperimentalConfig(projectPath))) return {}

  let userConfig: FileConfig | undefined

  try {
    userConfig = await loadConfigFile(configPath)
  } catch {
    return {}
  }

  const found = new Map<string, Set<string>>()
  collectDefineTypes(found, userConfig?.define)

  for (const scope of [userConfig?.browser, userConfig?.commands]) {
    if (!scope || typeof scope !== 'object') continue

    for (const entry of Object.values(scope as Record<string, unknown>)) {
      collectDefineTypes(
        found,
        (entry as {define?: unknown} | undefined)?.define
      )
    }
  }

  const types: Record<string, string> = {}

  for (const [key, set] of found) {
    types[key] = [...set].sort().join(' | ')
  }

  return types
}

export type ProjectConfigDefaults = Pick<
  FileConfig,
  'extensions' | 'transpilePackages' | 'perfBudgets' | 'define' | 'folders'
>

// Top-level `extensions`/`transpilePackages`/`perfBudgets` are the weakest
// layer: browser.<vendor> beats them, commands.<cmd> beats both, a CLI flag
// beats everything. They are returned on their own so no consumer sees a
// project-wide default wearing command-layer specificity.
export async function loadProjectConfigDefaults(
  projectPath: string
): Promise<ProjectConfigDefaults> {
  const configPath = findConfigFile(projectPath)

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = (await loadConfigFile(configPath)) as
          | ProjectConfigDefaults
          | undefined

        return {
          ...(userConfig?.extensions
            ? {extensions: userConfig.extensions}
            : {}),
          ...(Array.isArray(userConfig?.transpilePackages)
            ? {transpilePackages: userConfig.transpilePackages}
            : {}),
          ...(userConfig?.perfBudgets &&
          typeof userConfig.perfBudgets === 'object'
            ? {perfBudgets: userConfig.perfBudgets}
            : {}),
          ...(userConfig?.define && typeof userConfig.define === 'object'
            ? {define: userConfig.define}
            : {}),
          ...(userConfig?.folders && typeof userConfig.folders === 'object'
            ? {folders: userConfig.folders}
            : {})
        }
      } catch (err: unknown) {
        const error = err as Error
        reportConfigLoadingErrorOnce(configPath, error)

        throw err
      }
    }
  }

  return {}
}

type CommandConfigs = NonNullable<FileConfig['commands']>

// The commands.<cmd> layer alone. Top-level keys come from
// loadProjectConfigDefaults so each keeps its own specificity.
export type CommandLayerConfig = Partial<
  CommandConfigs['dev'] &
    CommandConfigs['build'] &
    CommandConfigs['start'] &
    CommandConfigs['preview']
> &
  ProjectConfigDefaults

export async function loadCommandConfig(
  projectPath: string,
  command: 'dev' | 'build' | 'start' | 'preview'
): Promise<CommandLayerConfig> {
  const configPath = findConfigFile(projectPath)

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(configPath)

        return (userConfig?.commands?.[command] || {}) as CommandLayerConfig
      } catch (err: unknown) {
        const error = err as Error
        reportConfigLoadingErrorOnce(configPath, error)

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
        reportConfigLoadingErrorOnce(configPath, error)

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
