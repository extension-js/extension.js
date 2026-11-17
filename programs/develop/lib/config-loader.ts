// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire, register as registerModuleHooks} from 'node:module'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import * as vm from 'node:vm'
import type {Configuration} from '@rspack/core'
import dotenv from 'dotenv'
import type {
  BrowserConfig,
  ConfigHookContext,
  DevOptions,
  FileConfig
} from '../types'
import {type CodedError, codedError} from './coded-error'
import {
  CHROMIUM_FAMILY_ALIASES,
  GECKO_FAMILY_ALIASES,
  isChromiumBasedBrowser,
  isGeckoBasedBrowser,
  isWebkitBasedBrowser
} from './constants'
import * as messages from './messages'
import {CODES, debugLine, isDebug} from './messaging'
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

// What a run is compiling for, as far as the caller knows it. The browser is
// often read from the config itself, so it can be absent on the first load.
export type ConfigEnvTarget = {mode?: string; browser?: string}

// The files the compiled bundle picks from, strongest first, in the order the
// env plugin uses. Without a browser only the files no browser owns apply.
export function envFileCandidates(mode: string, browser?: string): string[] {
  const shared = [`.env.${mode}`, '.env.local', '.env']
  if (!browser) return shared

  const isChromiumTarget =
    isChromiumBasedBrowser(browser) ||
    browser === 'safari' ||
    browser.includes('webkit')
  const familyNames = isChromiumTarget
    ? CHROMIUM_FAMILY_ALIASES
    : isGeckoBasedBrowser(browser)
      ? GECKO_FAMILY_ALIASES
      : []
  const names = [browser, ...familyNames.filter((name) => name !== browser)]

  return [
    ...names.flatMap((name) => [`.env.${name}.${mode}`, `.env.${name}`]),
    ...shared
  ]
}

// Only dev compiles in development. Every caller that loads the config with
// no command named is a build, start or preview path, so that is the default.
function envModeFor(command?: string, target?: ConfigEnvTarget): string {
  return target?.mode || (command === 'dev' ? 'development' : 'production')
}

// Env files from weakest to strongest: defaults only fill gaps, then the
// bundle's candidates from last to first, so the file the build picks wins.
// A key the shell already owns is never touched by any of them.
function envPreloadOrder(mode: string, browser?: string): string[] {
  return ['.env.defaults', ...envFileCandidates(mode, browser).reverse()]
}

// The config whose env files are on process.env now, and the file order each
// loaded config was read with, so a cached config gets its own keys back.
let envOwnerConfigPath: string | undefined
const envOrderByConfigPath = new Map<string, string[]>()

// What each preloaded key was set to, so a value something else wrote over
// it since is recognized as not a file value and left where it is.
const preloadedEnvValues = new Map<string, string>()

// One process can load two projects, and the first one's file values are not
// the second one's. What is left afterwards is what the shell really set.
function forgetPreloadedEnv(): void {
  for (const key of preloadedEnvKeys) {
    if (process.env[key] === preloadedEnvValues.get(key)) {
      delete process.env[key]
    }
  }

  preloadedEnvKeys.clear()
  preloadedEnvValues.clear()
}

function applyEnvFile(filePath: string, shellOwned: ReadonlySet<string>) {
  const parsed = dotenv.parse(fs.readFileSync(filePath))

  for (const [key, value] of Object.entries(parsed)) {
    if (shellOwned.has(key)) continue

    process.env[key] = value
    preloadedEnvKeys.add(key)
    preloadedEnvValues.set(key, value)
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

// Compiling and running are two steps on purpose: a file that does not parse
// as CommonJS never started, and only then may another route read it.
function compileCommonJsConfig(absolutePath: string): () => unknown {
  const code = fs.readFileSync(absolutePath, 'utf-8')
  const dirname = path.dirname(absolutePath)
  const requireFn = createRequire(absolutePath)

  // Emulate Node's CJS wrapper so __filename/__dirname match the real file,
  // avoiding the temp-.cjs copy that broke __dirname-relative configs.
  const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${code}\n})`
  const fn = new vm.Script(wrapped, {
    filename: absolutePath
  }).runInThisContext()

  return () => {
    const module = {exports: {} as ParsedJson}

    fn(module.exports, requireFn, module, absolutePath, dirname)

    return module.exports
  }
}

// Node's CJS loader covers what the vm wrapper cannot (a hashbang line). A
// sibling copy keeps relative requires and __dirname pointing at the project.
function copyBesideSourcePrefix(absolutePath: string): string {
  return `.${path.basename(absolutePath, path.extname(absolutePath))}.${process.pid}-`
}

export function requireCommonJsCopyBesideSource(absolutePath: string) {
  const requireFn = createRequire(absolutePath)
  const siblingCjsPath = path.join(
    path.dirname(absolutePath),
    `${copyBesideSourcePrefix(absolutePath)}${Date.now()}.cjs`
  )

  try {
    fs.copyFileSync(absolutePath, siblingCjsPath)

    return requireFn(siblingCjsPath) as ParsedJson
  } finally {
    delete requireFn.cache[siblingCjsPath]

    try {
      fs.rmSync(siblingCjsPath, {force: true})
    } catch {
      // Ignore
    }
  }
}

// Node's own words for a CommonJS global (require, module, exports,
// __dirname) read in a file it ran as an ES module: the file is the other kind.
function isCommonJsInEsModuleScope(importError: unknown): boolean {
  const message = String((importError as Error | undefined)?.message || '')

  return message.includes('is not defined in ES module scope')
}

// A parse failure is raised by Node's module loader with no frame inside the
// file. A SyntaxError the author's own code threw has one, and it did run.
function failedToParse(error: unknown, fileMarker: string): boolean {
  const {name, stack} = (error || {}) as Partial<Error>
  if (name !== 'SyntaxError' || typeof stack !== 'string') return false

  const frames = stack.split('\n').filter((line) => /^\s+at /.test(line))

  return (
    frames.length > 0 &&
    frames[0].includes('node:internal/modules/') &&
    !frames.some((frame) => frame.includes(fileMarker))
  )
}

// Errors this loader caught and reports itself, held for one turn of the
// event loop: long enough for Node to announce a promise that shares one.
const claimedConfigErrors = new Set<unknown>()
let openClaimWindows = 0

function onRejectionDuringClaim(reason: unknown): void {
  if (claimedConfigErrors.has(reason)) return

  // Any other rejection keeps its normal fate: another listener decides, and
  // with none it is raised the way Node raises it when nobody listens.
  if (process.listenerCount('unhandledRejection') > 1) return

  throw reason
}

// Node 22.12 rejects a promise no code can reach when require() loads an ES
// module that throws. The same error object is already on its way out, coded.
function claimRejectionOf(caught: unknown): void {
  if (openClaimWindows === 0) {
    process.on('unhandledRejection', onRejectionDuringClaim)
  }

  openClaimWindows += 1
  claimedConfigErrors.add(caught)

  setImmediate(() => {
    openClaimWindows -= 1
    if (openClaimWindows > 0) return

    claimedConfigErrors.clear()
    process.off('unhandledRejection', onRejectionDuringClaim)
  })
}

type CommonJsRetry = {loaded: unknown} | {reason: unknown}

// The retry runs the file as CommonJS text and never hands it to require(),
// so a throwing ES module is not loaded a second time through that path.
// Whatever the file throws once it runs is the reason, and nothing runs after.
function loadCommonJsConfigAfterFailedImport(
  absolutePath: string,
  importError: unknown
): CommonJsRetry {
  let run: () => unknown

  try {
    run = compileCommonJsConfig(absolutePath)
  } catch {
    if (!isCommonJsInEsModuleScope(importError)) return {reason: importError}

    try {
      return {loaded: requireCommonJsCopyBesideSource(absolutePath)}
    } catch (copyError) {
      claimRejectionOf(copyError)

      return {
        reason: failedToParse(copyError, copyBesideSourcePrefix(absolutePath))
          ? importError
          : copyError
      }
    }
  }

  try {
    return {loaded: run()}
  } catch (wrapperError) {
    claimRejectionOf(wrapperError)

    return {reason: wrapperError}
  }
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
  order: string[]
): EnvPreloadResult {
  let loadedAny = false
  // Snapshot before any file loads: a later, stronger file may override an
  // earlier file's value but never a value the shell or CI exported.
  const shellOwned = new Set(
    Object.keys(process.env).filter((key) => !preloadedEnvKeys.has(key))
  )

  for (const filename of order) {
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

function preloadEnvFiles(projectDir: string, order: string[]) {
  forgetPreloadedEnv()

  const local = preloadEnvFilesFromDir(projectDir, order)
  if (local.loadedAny) return local

  const workspaceRoot = findNearestWorkspaceRoot(projectDir)

  if (workspaceRoot && workspaceRoot !== projectDir) {
    return preloadEnvFilesFromDir(workspaceRoot, order)
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

class ConfigShapeError extends Error {
  public readonly code = CODES.E_CONFIG_LOAD
}

// A config that throws is the author's to fix: one finished block naming the
// file and the reason, coded so a JSON reader gets the documented class.
function configLoadError(configPath: string, cause: unknown): CodedError {
  return Object.assign(
    codedError(
      CODES.E_CONFIG_LOAD,
      messages.configLoadingError(configPath, cause)
    ),
    {cause}
  )
}

function isConfigLoadError(error: unknown): boolean {
  return (error as {code?: unknown} | null)?.code === CODES.E_CONFIG_LOAD
}

const loadedConfigCache = new Map<string, Promise<FileConfig>>()

// Four loaders each report before rethrowing, so one bad config printed the
// same frame once per entry point. The command-level handler prints the reason.
const reportedConfigPaths = new Set<string>()

export function reportConfigLoadingErrorOnce(
  configPath: string,
  error: unknown
): void {
  // A throwing config and a wrong shape are finished blocks the command
  // prints itself, so a frame from here would say it a second time.
  if (isConfigLoadError(error)) return

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
  'exclude',
  'extensions',
  'folders',
  'include',
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

// One config loads at a time: the env files of the one being evaluated are
// on process.env, and a second project preloading in between would swap them.
let configLoadQueue: Promise<unknown> = Promise.resolve()

async function loadConfigFile(
  configPath: string,
  envOrder: string[] = envPreloadOrder(envModeFor())
): Promise<FileConfig> {
  const absolutePath = path.resolve(configPath)

  const cached = loadedConfigCache.get(absolutePath)

  if (cached) {
    const config = await cached

    // Another project loaded since: hand this one its own file values back.
    if (envOwnerConfigPath !== absolutePath) {
      preloadEnvFiles(
        path.dirname(absolutePath),
        envOrderByConfigPath.get(absolutePath) || envOrder
      )

      envOwnerConfigPath = absolutePath
    }

    return config
  }

  const loading = configLoadQueue
    .then(() => loadConfigFileUncached(absolutePath, envOrder))
    .then((value) => {
      assertConfigShape(absolutePath, value)

      return value
    })
  loadedConfigCache.set(absolutePath, loading)
  configLoadQueue = loading.catch(() => undefined)

  try {
    return await loading
  } catch (error) {
    // Don't poison the cache with a transient failure.
    loadedConfigCache.delete(absolutePath)

    throw error
  }
}

// A config file with side effects runs once per load. Another route may read
// it only when the first failure proves the file never ran as that kind.
function canRetryAsCommonJs(absolutePath: string, importError: unknown) {
  // An .mjs file is an ES module by name, and require() already read a .cjs.
  if (/\.[cm]js$/.test(absolutePath)) return false

  return (
    isCommonJsInEsModuleScope(importError) ||
    failedToParse(importError, `${path.basename(absolutePath)}:`)
  )
}

async function loadConfigFileUncached(
  absolutePath: string,
  envOrder: string[]
): Promise<FileConfig> {
  const projectDir = path.dirname(absolutePath)

  preloadEnvFiles(projectDir, envOrder)
  envOwnerConfigPath = absolutePath
  envOrderByConfigPath.set(absolutePath, envOrder)

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
    let reason = err

    claimRejectionOf(err)

    if (canRetryAsCommonJs(absolutePath, err)) {
      const retry = loadCommonJsConfigAfterFailedImport(absolutePath, err)

      if ('loaded' in retry) {
        return unwrapDefaultExport(retry.loaded) as FileConfig
      }

      reason = retry.reason
    }

    try {
      const content = fs.readFileSync(absolutePath, 'utf-8')

      return JSON.parse(content)
    } catch {
      throw configLoadError(absolutePath, reason)
    }
  }
}

export async function loadCustomConfig(
  projectPath: string,
  context: ConfigHookContext
) {
  const configPath = findConfigFile(projectPath)

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(
          configPath,
          envPreloadOrder(context.mode, String(context.browser))
        )

        if (userConfig && typeof userConfig.config === 'function') {
          const hook = userConfig.config

          return (config: Configuration) => hook(config, context)
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
  | 'extensions'
  | 'transpilePackages'
  | 'perfBudgets'
  | 'define'
  | 'folders'
  | 'include'
  | 'exclude'
>

// Top-level `extensions`/`transpilePackages`/`perfBudgets` are the weakest
// layer: browser.<vendor> beats them, commands.<cmd> beats both, a CLI flag
// beats everything. They are returned on their own so no consumer sees a
// project-wide default wearing command-layer specificity.
export async function loadProjectConfigDefaults(
  projectPath: string,
  envTarget?: ConfigEnvTarget
): Promise<ProjectConfigDefaults> {
  const configPath = findConfigFile(projectPath)

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = (await loadConfigFile(
          configPath,
          envPreloadOrder(envModeFor(undefined, envTarget), envTarget?.browser)
        )) as ProjectConfigDefaults | undefined

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
            : {}),
          ...(userConfig?.include && typeof userConfig.include === 'object'
            ? {include: userConfig.include}
            : {}),
          ...(Array.isArray(userConfig?.exclude)
            ? {exclude: userConfig.exclude}
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
  command: 'dev' | 'build' | 'start' | 'preview',
  envTarget?: ConfigEnvTarget
): Promise<CommandLayerConfig> {
  const configPath = findConfigFile(projectPath)

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(
          configPath,
          envPreloadOrder(envModeFor(command, envTarget), envTarget?.browser)
        )

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
        debugLine(messages.isUsingExperimentalConfig('extension.config.js'))
      }

      userMessageDelivered = true
    }

    return true
  }

  return false
}
