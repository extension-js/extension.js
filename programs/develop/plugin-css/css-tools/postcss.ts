//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {hasDependency} from '../../lib/has-dependency'
import {debugLine, isDebug, prefix} from '../../lib/messaging'
import type {AnyModule} from '../../lib/optional-deps-resolver'
import {
  ensureOptionalContractPackageResolved,
  formatInstallHint
} from '../../lib/optional-deps-resolver'
import {resolvePackageManager} from '../../lib/package-manager'
import {readProjectDependencies} from '../../lib/project-manifest'
import type {StyleLoaderOptions} from '../common-style-loaders'
import * as messages from '../css-lib/messages'
import {reportStyleDiagnostic} from '../css-lib/style-diagnostics'
import {
  getTailwindConfigFile,
  isUsingTailwind,
  TAILWIND_CONFIG_NAMES
} from './tailwind'

let userMessageDelivered = false

// postcss-load-config's documented order (rc files before postcss.config.*),
// then the .config/ spellings postcss-loader also reads.
export const postCssConfigSearchPlaces = [
  '.postcssrc',
  '.postcssrc.json',
  '.postcssrc.yaml',
  '.postcssrc.yml',
  '.postcssrc.ts',
  '.postcssrc.cts',
  '.postcssrc.mts',
  '.postcssrc.js',
  '.postcssrc.cjs',
  '.postcssrc.mjs',
  'postcss.config.ts',
  'postcss.config.cts',
  'postcss.config.mts',
  'postcss.config.js',
  'postcss.config.cjs',
  'postcss.config.mjs',
  '.config/postcssrc',
  '.config/postcssrc.json',
  '.config/postcssrc.yaml',
  '.config/postcssrc.yml',
  '.config/postcssrc.ts',
  '.config/postcssrc.cts',
  '.config/postcssrc.mts',
  '.config/postcssrc.js',
  '.config/postcssrc.cjs',
  '.config/postcssrc.mjs'
]

function orderedSearchPlaces(projectPath: string): string[] {
  if (!isTypeModuleProject(projectPath)) return postCssConfigSearchPlaces

  // A plain .js config is the ambiguous one in a "type: module" project, so
  // every unambiguous spelling gets to win before it.
  const isPlainJs = (place: string) => (place.endsWith('.js') ? 1 : 0)

  return [...postCssConfigSearchPlaces].sort(
    (a, b) => isPlainJs(a) - isPlainJs(b)
  )
}

export function findPostCssConfig(projectPath: string): string | undefined {
  for (const configFile of orderedSearchPlaces(projectPath)) {
    const configPath = path.join(projectPath, configFile)

    if (fs.existsSync(configPath)) {
      return configPath
    }
  }

  return undefined
}

// Names that read like a PostCSS config and that PostCSS never looks for,
// each with the name it does read for the same format.
const IGNORED_CONFIG_NAMES: Record<string, string> = {
  'postcss.config.json': '.postcssrc.json',
  'postcss.config.yaml': '.postcssrc.yaml',
  'postcss.config.yml': '.postcssrc.yml'
}

export function findIgnoredPostCssConfigs(
  projectPath: string
): Array<{file: string; rename: string}> {
  return Object.entries(IGNORED_CONFIG_NAMES)
    .map(([name, rename]) => ({file: path.join(projectPath, name), rename}))
    .filter(({file}) => fs.existsSync(file))
}

// Every file whose edit can change what PostCSS does to this project.
export function postCssSetupFiles(projectPath: string): string[] {
  return [
    ...orderedSearchPlaces(projectPath),
    ...TAILWIND_CONFIG_NAMES,
    'package.json'
  ].map((name) => path.join(projectPath, name))
}

type RequireRegistry = NodeJS.Require['cache']

function isProjectModule(file: string, projectPath: string): boolean {
  const inside = path.relative(projectPath, file).split(path.sep)

  return (
    inside[0] !== '..' &&
    !path.isAbsolute(inside.join(path.sep)) &&
    !inside.includes('node_modules')
  )
}

// Forgets a module and each project file it loaded, so the next read of a
// config runs the helpers it requires again. Packages stay as loaded.
function dropProjectModules(
  file: string,
  projectPath: string,
  registry: RequireRegistry,
  seen = new Set<string>()
) {
  const entry = registry[file]
  if (!entry || seen.has(file)) return

  seen.add(file)

  for (const child of entry.children) {
    if (isProjectModule(child.filename, projectPath)) {
      dropProjectModules(child.filename, projectPath, registry, seen)
    }
  }

  delete registry[file]
}

function realPathOf(file: string): string {
  try {
    return fs.realpathSync(file)
  } catch {
    return file
  }
}

// One number for each read in this process. A file time would repeat for two
// saves inside one tick of the clock, or on a disk that keeps whole seconds.
let freshImports = 0

// Node keeps every module it imported, so an edited config would come back
// as the one read first. A new address and a dropped require entry reload it.
async function importFresh(
  file: string,
  projectPath: string
): Promise<AnyModule> {
  const registry = createRequire(import.meta.url).cache
  const root = realPathOf(projectPath)

  dropProjectModules(realPathOf(file), root, registry)
  dropProjectModules(file, root, registry)

  return import(`${pathToFileURL(file).href}?t=${++freshImports}`)
}

// A YAML config, read with the parser postcss-loader itself reads it with.
// Undefined when that parser is not found, and the loader then reads the file.
async function readYamlConfig(
  configPath: string,
  projectPath: string
): Promise<AnyModule | undefined> {
  try {
    const loader = await ensureOptionalContractPackageResolved({
      contractId: 'postcss',
      projectPath,
      dependencyId: 'postcss-loader'
    })
    const fromLoader = createRequire(
      fs.statSync(loader).isDirectory()
        ? path.join(loader, 'package.json')
        : loader
    )
    const yaml = createRequire(fromLoader.resolve('cosmiconfig'))('js-yaml')

    return yaml.load(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return undefined
  }
}

function isTypeModuleProject(projectPath: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw || '{}')

    return pkg?.type === 'module'
  } catch {
    return false
  }
}

function isLikelyCjsConfigInEsmProject(
  projectPath: string,
  postCssConfigPath?: string
): boolean {
  if (!postCssConfigPath || !postCssConfigPath.endsWith('postcss.config.js')) {
    return false
  }

  if (!isTypeModuleProject(projectPath)) return false

  try {
    const text = fs.readFileSync(postCssConfigPath, 'utf8')

    return /module\.exports|require\(/.test(text)
  } catch {
    return false
  }
}

function isLikelyCjsTailwindConfig(tailwindConfigPath?: string): boolean {
  if (!tailwindConfigPath) return false

  if (
    !tailwindConfigPath.endsWith('.js') &&
    !tailwindConfigPath.endsWith('.cjs')
  ) {
    return false
  }

  try {
    const text = fs.readFileSync(tailwindConfigPath, 'utf8')

    return /module\.exports|require\(/.test(text)
  } catch {
    return false
  }
}

function userConfigMentionsTailwindPlugin(postCssConfigPath?: string): boolean {
  if (!postCssConfigPath) return false

  try {
    const text = fs.readFileSync(postCssConfigPath, 'utf8')

    // Best-effort detection for common config styles: JS plugin maps/arrays and
    // JSON/YAML rc names for tailwindcss / @tailwindcss/postcss.
    return /@tailwindcss\/postcss|tailwindcss/.test(text)
  } catch {
    return false
  }
}

function userConfigUsesDirectTailwindPluginReference(
  postCssConfigPath?: string
): boolean {
  if (!postCssConfigPath) return false

  try {
    const text = fs.readFileSync(postCssConfigPath, 'utf8')

    // Detect CJS/JS patterns where config executes/holds a Tailwind function:
    // require('tailwindcss') assignments and plugins arrays.
    return (
      /require\(\s*['"]tailwindcss['"]\s*\)/.test(text) ||
      /plugins\s*:\s*\[[^\]]*\btailwindcss\b/.test(text)
    )
  } catch {
    return false
  }
}

function tailwindStringPluginDisableShims() {
  // Keep each disable shim as a single-key object.
  // postcss-loader accepts this shape while resolving string plugins from config.
  return [{'@tailwindcss/postcss': false}, {tailwindcss: false}]
}

function isTypeScriptConfig(configPath: string): boolean {
  return /\.[mc]?ts$/.test(configPath)
}

// `outcome.refused` tells a config that was reported and set aside from one
// that is left for postcss-loader to read (YAML, TypeScript).
export async function loadUserPostCssConfigObject(
  configPath: string,
  projectPath: string,
  mode: string,
  outcome: {refused: boolean} = {refused: false},
  report: (message: string) => void = (message) =>
    reportStyleDiagnostic(projectPath, message)
): Promise<AnyModule | undefined> {
  let loaded: AnyModule

  try {
    const base = path.basename(configPath)

    if (
      base === '.postcssrc' ||
      base === 'postcssrc' ||
      configPath.endsWith('.json')
    ) {
      loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } else if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
      // Read here, a plugin it names resolves from the project. Left to
      // postcss-loader, the name resolves from the loader's own folder.
      loaded = await readYamlConfig(configPath, projectPath)

      if (loaded === undefined) return undefined
    } else if (configPath.endsWith('.cjs')) {
      loaded = tryLoadCjsConfig(configPath, {report, projectPath})

      if (loaded === undefined) {
        outcome.refused = true

        return undefined
      }
    } else {
      try {
        const mod = await importFresh(configPath, projectPath)
        loaded = mod?.default ?? mod
      } catch (importError) {
        // A CJS-shaped file under an ESM import fails on `module`; the
        // hand-rolled CJS load gets its own turn, and only if that fails
        // too is the file reported as unreadable.
        loaded = tryLoadCjsConfig(configPath, {projectPath})

        if (loaded === undefined) {
          // A TypeScript config this Node build cannot strip is not broken:
          // postcss-loader reads it with the jiti loader it ships.
          if (!isTypeScriptConfig(configPath)) {
            report(messages.postCssConfigUnreadable(configPath, importError))

            outcome.refused = true
          }

          return undefined
        }
      }
    }
  } catch (error) {
    report(messages.postCssConfigUnreadable(configPath, error))

    outcome.refused = true

    return undefined
  }

  if (typeof loaded === 'function') {
    try {
      loaded = loaded({env: mode, mode, cwd: projectPath})
    } catch (error) {
      report(messages.postCssConfigUnreadable(configPath, error))

      outcome.refused = true

      return undefined
    }
  }

  if (!loaded || typeof loaded !== 'object') return undefined

  // A plugins value PostCSS could never take is a config mistake, not an
  // absent config: say so instead of silently dropping the whole file.
  const plugins = (loaded as {plugins?: unknown}).plugins

  if (
    plugins !== undefined &&
    plugins !== null &&
    !Array.isArray(plugins) &&
    typeof plugins !== 'object'
  ) {
    report(messages.postCssConfigPluginsShape(configPath, typeof plugins))

    outcome.refused = true

    return undefined
  }

  return loaded
}

function unwrapDefaultExport(mod: AnyModule): AnyModule {
  return mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod
}

const TAILWIND_PLUGIN_IDS = ['@tailwindcss/postcss', 'tailwindcss']

// Resolve string plugin names project-first: postcss-loader resolves relative
// to itself, so a CLI outside the project never sees project node_modules.
function resolveConfigPluginModule(
  name: string,
  projectPath: string,
  configDir: string | undefined
): AnyModule | undefined {
  const bases = Array.from(
    new Set([projectPath, configDir || ''].filter(Boolean))
  )

  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, '__extensionjs__.js'))

      return unwrapDefaultExport(req(name))
    } catch {
      // Ignore
    }
  }

  // Tailwind compiles the project's own classes with the project's own
  // version, so a copy that sits beside the CLI never stands in for it.
  if (TAILWIND_PLUGIN_IDS.includes(name)) return undefined

  try {
    const req = createRequire(import.meta.url)

    return unwrapDefaultExport(req(name))
  } catch {
    return undefined
  }
}

// Normalize a config plugins value (map or array) into instantiated plugins;
// undefined when the shape is not understood so callers can fall back.
function resolveConfigPluginList(
  rawPlugins: AnyModule,
  ctx: {
    projectPath: string
    configDir?: string
    tailwindInstance?: AnyModule
    // Function values referencing Tailwind may be legacy creators that throw; bail
    // out of self-loading so the legacy bypass path can rescue them.
    bailOnFunctionEntries?: boolean
  }
): {plugins: AnyModule[]; unresolved: string[]} | undefined {
  const entries: Array<[AnyModule, AnyModule]> = []

  if (Array.isArray(rawPlugins)) {
    for (const entry of rawPlugins) {
      if (Array.isArray(entry)) entries.push([entry[0], entry[1]])
      else entries.push([entry, undefined])
    }
  } else if (rawPlugins && typeof rawPlugins === 'object') {
    for (const [name, pluginOpts] of Object.entries(rawPlugins)) {
      entries.push([name, pluginOpts])
    }
  } else {
    return undefined
  }

  const plugins: AnyModule[] = []
  const unresolved: string[] = []
  let tailwindUsed = false

  for (const [entry, pluginOpts] of entries) {
    if (pluginOpts === false) continue

    if (typeof entry !== 'string') {
      if (ctx.bailOnFunctionEntries) return undefined
      if (entry) plugins.push(entry)

      continue
    }

    const isTailwind = TAILWIND_PLUGIN_IDS.includes(entry)

    if (isTailwind) {
      if (tailwindUsed) continue

      if (ctx.tailwindInstance) {
        plugins.push(ctx.tailwindInstance)
        tailwindUsed = true
        continue
      }
    }

    const mod = resolveConfigPluginModule(entry, ctx.projectPath, ctx.configDir)

    if (typeof mod === 'function') {
      const callOpts =
        entry === '@tailwindcss/postcss'
          ? {
              base: ctx.projectPath,
              ...(pluginOpts && typeof pluginOpts === 'object'
                ? pluginOpts
                : {})
            }
          : pluginOpts == null || pluginOpts === true
            ? {}
            : pluginOpts

      try {
        plugins.push(mod(callOpts))
        if (isTailwind) tailwindUsed = true
      } catch {
        unresolved.push(entry)
      }
    } else if (mod && typeof mod === 'object') {
      plugins.push(mod)
      if (isTailwind) tailwindUsed = true
    } else {
      unresolved.push(entry)
    }
  }

  return {plugins, unresolved}
}

function tryLoadCjsConfig(
  configPath: string,
  options: {report?: (message: string) => void; projectPath?: string} = {}
): AnyModule | undefined {
  try {
    const source = fs.readFileSync(configPath, 'utf8')
    const moduleObj: {exports: AnyModule} = {exports: {}}
    const exportsObj = moduleObj.exports
    const load = createRequire(configPath)
    const root = realPathOf(options.projectPath ?? path.dirname(configPath))
    // A project file the config requires is run again on each read, or an
    // edit to it would not show until the process ends.
    const req = Object.assign((id: string) => {
      try {
        const file = load.resolve(id)

        if (isProjectModule(file, root)) {
          dropProjectModules(file, root, load.cache)
        }
      } catch {
        // The require below reports a module that does not resolve.
      }

      return load(id)
    }, load)
    const fn = new Function(
      'require',
      'module',
      'exports',
      '__filename',
      '__dirname',
      source
    )
    fn(req, moduleObj, exportsObj, configPath, path.dirname(configPath))

    return moduleObj.exports
  } catch (error) {
    options.report?.(messages.postCssConfigUnreadable(configPath, error))

    return undefined
  }
}

function normalizeTailwindContentGlobs(
  config: AnyModule,
  projectPath: string
): AnyModule {
  if (!config || typeof config !== 'object') return config

  const normalizeEntry = (entry: AnyModule) => {
    if (typeof entry !== 'string') return entry

    if (entry.startsWith('!')) {
      const raw = entry.slice(1)
      if (path.isAbsolute(raw)) return entry

      return `!${path.join(projectPath, raw)}`
    }

    return path.isAbsolute(entry) ? entry : path.join(projectPath, entry)
  }

  const out = {...config}
  const content = out.content

  if (typeof content === 'string') {
    out.content = [normalizeEntry(content)]

    return out
  }

  if (Array.isArray(content)) {
    out.content = content.map(normalizeEntry)

    return out
  }

  if (content && typeof content === 'object' && Array.isArray(content.files)) {
    out.content = {
      ...content,
      files: content.files.map(normalizeEntry)
    }
  }

  return out
}

function getDeclaredTailwindMajor(projectPath: string): number | undefined {
  try {
    const version = readProjectDependencies(projectPath).tailwindcss
    if (typeof version !== 'string') return undefined

    const match = version.match(/(\d+)/)
    if (!match) return undefined

    return parseInt(match[1], 10)
  } catch {
    return undefined
  }
}

// The command that puts Tailwind's PostCSS plugin in the project: an add for
// what package.json does not list, an install for what it lists already.
function tailwindInstallFix(
  projectPath: string,
  declaredMajor: number | undefined
): string {
  const needed =
    typeof declaredMajor === 'number' && declaredMajor < 4
      ? ['tailwindcss']
      : ['tailwindcss', '@tailwindcss/postcss']
  const unlisted = needed.filter((name) => !hasDependency(projectPath, name))

  return unlisted.length > 0
    ? formatInstallHint(projectPath, unlisted)
    : `${resolvePackageManager({cwd: projectPath}).name} install`
}

export function isUsingPostCss(projectPath: string): boolean {
  if (hasDependency(projectPath, 'postcss')) {
    if (!userMessageDelivered) {
      if (isDebug()) {
        debugLine(
          `${prefix('debug')} ${messages.isUsingIntegration('PostCSS')}`
        )
      }

      userMessageDelivered = true
    }

    return true
  }

  if (findPostCssConfig(projectPath)) {
    if (!userMessageDelivered) {
      if (isDebug()) {
        debugLine(
          `${prefix('debug')} ${messages.isUsingIntegration('PostCSS')}`
        )
      }

      userMessageDelivered = true
    }

    return true
  }

  if (isUsingTailwind(projectPath)) {
    if (!userMessageDelivered) {
      if (isDebug()) {
        debugLine(
          `${prefix('debug')} ${messages.isUsingIntegration('PostCSS')}`
        )
      }

      userMessageDelivered = true
    }

    return true
  }

  return false
}

export type PostCssRuleReader = (
  projectPath: string,
  opts: StyleLoaderOptions
) => Promise<Record<string, AnyModule>>

export interface PostCssCompilerReader extends PostCssRuleReader {
  // Reads every config again and updates the rules already handed out.
  // False when a rule would appear or go away, which takes a new compiler.
  reread(): Promise<boolean>
}

const SETUP_FILES_PLUGIN = 'extension-js-postcss-setup-files'

// PostCSS tells the bundler which files a sheet depends on. Naming the
// config files makes an edit to one of them rebuild every sheet.
function withSetupFilesWatched(
  projectPath: string,
  rule: Record<string, AnyModule>
): Record<string, AnyModule> {
  const postcssOptions = rule.options?.postcssOptions
  if (!rule.loader || !postcssOptions) return rule

  const files = postCssSetupFiles(projectPath)

  postcssOptions.plugins = [
    ...(postcssOptions.plugins || []),
    {
      postcssPlugin: SETUP_FILES_PLUGIN,
      Once(_root: unknown, {result}: {result: {messages: unknown[]}}) {
        for (const file of files) {
          // A config that is not there yet counts too, once it is written.
          result.messages.push({
            type: fs.existsSync(file) ? 'dependency' : 'missing-dependency',
            plugin: SETUP_FILES_PLUGIN,
            file
          })
        }
      }
    }
  ]

  return rule
}

// One compiler builds 24 style rules from one config. Its reader loads the
// config once per project and mode, and a new compiler starts a new reader.
export function postCssReaderForOneCompiler(
  warn?: (message: string) => void
): PostCssCompilerReader {
  const read = new Map<
    string,
    {
      projectPath: string
      opts: StyleLoaderOptions
      rule: Promise<Record<string, AnyModule>>
    }
  >()

  const reader: PostCssCompilerReader = (projectPath, opts) => {
    const key = `${projectPath}\0${String(opts.mode || 'development')}`
    let entry = read.get(key)

    if (!entry) {
      const readOpts = {...opts, warn: warn ?? opts.warn}

      entry = {
        projectPath,
        opts: readOpts,
        rule: maybeUsePostCss(projectPath, readOpts).then((rule) =>
          withSetupFilesWatched(projectPath, rule)
        )
      }

      read.set(key, entry)
    }

    return entry.rule
  }

  reader.reread = async () => {
    let applied = true

    for (const entry of read.values()) {
      const current = await entry.rule
      let next: Record<string, AnyModule>

      try {
        next = withSetupFilesWatched(
          entry.projectPath,
          await maybeUsePostCss(entry.projectPath, entry.opts)
        )
      } catch {
        applied = false
        continue
      }

      if (Boolean(current.loader) !== Boolean(next.loader)) {
        applied = false
        continue
      }

      if (!current.loader) continue

      // Every rule of the compiler holds this one object, and the loader
      // reads it on each run, so the next build compiles with the new config.
      const live = current.options.postcssOptions

      for (const key of Object.keys(live)) delete live[key]

      Object.assign(live, next.options.postcssOptions)
    }

    return applied
  }

  return reader
}

export async function maybeUsePostCss(
  projectPath: string,
  opts: StyleLoaderOptions
): Promise<Record<string, AnyModule>> {
  const foundPostCssConfig = findPostCssConfig(projectPath)
  const {hasPostCss: pkgHasPostCss, config: pkgPostCssConfig} =
    getPackageJsonConfig(projectPath)
  const packageJsonConfigWins =
    pkgHasPostCss && !!pkgPostCssConfig && typeof pkgPostCssConfig === 'object'
  const fileOutcome = {refused: false}
  let fileConfigObject: AnyModule
  // Inside a compiler a finding goes onto the build it belongs to. A caller
  // with no build to put it on prints it.
  const report = (message: string, print?: (message: string) => void) =>
    opts.warn
      ? opts.warn(message)
      : reportStyleDiagnostic(projectPath, message, print)

  if (foundPostCssConfig && !packageJsonConfigWins) {
    try {
      fileConfigObject = await loadUserPostCssConfigObject(
        foundPostCssConfig,
        projectPath,
        String(opts.mode || 'development'),
        fileOutcome,
        report
      )
    } catch {
      fileConfigObject = undefined
    }
  }

  // A config that was reported as set aside never reaches postcss-loader,
  // so the styles compile and the warning's promise holds.
  const configRefused = fileOutcome.refused
  const userPostCssConfig = foundPostCssConfig
  const userConfigMentionsTailwind =
    userConfigMentionsTailwindPlugin(userPostCssConfig)
  const userConfigUsesDirectTailwindReference =
    userConfigUsesDirectTailwindPluginReference(userPostCssConfig)
  const userConfigIsCjsInEsm = isLikelyCjsConfigInEsmProject(
    projectPath,
    userPostCssConfig
  )

  function getPackageJsonConfig(p: string): {
    hasPostCss: boolean
    config?: AnyModule
  } {
    try {
      const raw = fs.readFileSync(path.join(p, 'package.json'), 'utf8')
      const pkg = JSON.parse(raw || '{}')

      return {hasPostCss: !!pkg?.postcss, config: pkg?.postcss}
    } catch {
      return {hasPostCss: false}
    }
  }

  const tailwindPresent = isUsingTailwind(projectPath)
  const tailwindConfigured = tailwindPresent || userConfigMentionsTailwind

  // Only add postcss-loader when there's a clear signal of usage
  if (
    (!userPostCssConfig || configRefused) &&
    !pkgHasPostCss &&
    !tailwindPresent
  ) {
    return {}
  }

  const resolvedPostCssLoader = await ensureOptionalContractPackageResolved({
    contractId: 'postcss',
    projectPath,
    dependencyId: 'postcss-loader'
  })

  // Optionally pre-resolve the Tailwind PostCSS plugin from the project so
  // postcss-loader never requires it from the extensionjs cache path.
  let pluginsFromOptions: AnyModule[] | undefined
  let tailwindResolvedInstance: AnyModule
  const shouldInjectTailwindPlugin =
    tailwindConfigured &&
    !pkgHasPostCss &&
    (!userPostCssConfig ||
      configRefused ||
      userConfigIsCjsInEsm ||
      userConfigMentionsTailwind)
  const declaredTailwindMajor = getDeclaredTailwindMajor(projectPath)

  let tailwindMissing = false

  if (shouldInjectTailwindPlugin) {
    let setupError: unknown
    let tailwindPluginId: string | undefined

    try {
      // The project and its config folder only. The folder the CLI runs
      // from can hold another Tailwind, of another version.
      const bases = Array.from(
        new Set(
          [
            projectPath,
            userPostCssConfig ? path.dirname(userPostCssConfig) : ''
          ].filter(Boolean)
        )
      )
      // Tailwind v3 uses `tailwindcss` directly as PostCSS plugin.
      // Tailwind v4 uses `@tailwindcss/postcss`.
      const pluginCandidates =
        typeof declaredTailwindMajor === 'number' && declaredTailwindMajor < 4
          ? ['tailwindcss', '@tailwindcss/postcss']
          : ['@tailwindcss/postcss', 'tailwindcss']
      let tailwindMod: AnyModule | undefined

      for (const base of bases) {
        try {
          const req = createRequire(path.join(base, '__extensionjs__.js'))

          for (const id of pluginCandidates) {
            try {
              tailwindMod = req(id)
              tailwindPluginId = id
              break
            } catch {
              // Ignore
            }
          }

          if (tailwindMod) break
        } catch {
          // Ignore
        }
      }

      if (tailwindMod) {
        if (
          tailwindMod &&
          typeof tailwindMod === 'object' &&
          'default' in tailwindMod
        ) {
          tailwindMod = tailwindMod.default
        }

        if (typeof tailwindMod === 'function') {
          let instance: AnyModule

          try {
            // v4 plugin supports {base}; v3 plugin should receive {config}
            // to preserve user theme/content tokens like border-border.
            if (tailwindPluginId === 'tailwindcss') {
              const configFile = getTailwindConfigFile(projectPath)

              if (configFile) {
                // Load CJS config to normalize relative content globs against the extension
                // project path, avoiding cwd-dependent misses in monorepos.
                if (isLikelyCjsTailwindConfig(configFile)) {
                  const loaded = tryLoadCjsConfig(configFile, {
                    report,
                    projectPath
                  })

                  if (loaded && typeof loaded === 'object') {
                    const normalized = normalizeTailwindContentGlobs(
                      loaded,
                      projectPath
                    )
                    instance = tailwindMod(normalized)
                  } else {
                    instance = tailwindMod({config: configFile})
                  }
                } else {
                  instance = tailwindMod({config: configFile})
                }
              } else {
                instance = tailwindMod()
              }
            } else {
              // Anchor Tailwind source scanning to the extension project root.
              // This avoids cwd-dependent misses for arbitrary-value classes in monorepos.
              instance = tailwindMod({base: projectPath})
            }
          } catch (firstError) {
            // The first failure is the cause. The retries below fail for
            // reasons of their own, which would name the wrong fix.
            setupError = firstError

            // Keep compatibility with plugin versions that don't accept options.
            try {
              instance = tailwindMod()
            } catch {
              // Recovery: if direct tailwindcss execution fails (e.g. v4), try loading
              // @tailwindcss/postcss anchored to the project root.
              if (tailwindPluginId === 'tailwindcss') {
                for (const base of bases) {
                  try {
                    const req = createRequire(
                      path.join(base, '__extensionjs__.js')
                    )
                    let postcssMod = req('@tailwindcss/postcss')

                    if (
                      postcssMod &&
                      typeof postcssMod === 'object' &&
                      'default' in postcssMod
                    ) {
                      postcssMod = postcssMod.default
                    }

                    if (typeof postcssMod === 'function') {
                      instance = postcssMod({base: projectPath})
                      tailwindPluginId = '@tailwindcss/postcss'
                      break
                    }
                  } catch {
                    // The first failure stays the one that is reported.
                  }
                }
              }
            }
          }

          if (instance) {
            tailwindResolvedInstance = instance
            pluginsFromOptions = userConfigIsCjsInEsm
              ? [instance]
              : [
                  // Disable any string-configured Tailwind plugins from user config,
                  // so loadPlugin() never resolves them from a cwd-dependent location.
                  ...tailwindStringPluginDisableShims(),
                  instance
                ]
          }
        } else if (
          tailwindMod &&
          typeof tailwindMod === 'object' &&
          'postcssPlugin' in tailwindMod
        ) {
          tailwindResolvedInstance = tailwindMod
          pluginsFromOptions = userConfigIsCjsInEsm
            ? [tailwindMod]
            : [...tailwindStringPluginDisableShims(), tailwindMod]
        }
      }
    } catch (error) {
      // Never break the build from here; let postcss-loader handle errors.
      setupError ??= error
    }

    if (!tailwindResolvedInstance && setupError !== undefined) {
      opts.warn?.(
        messages.tailwindSetupFailed(
          tailwindPluginId ?? '@tailwindcss/postcss',
          projectPath,
          setupError
        )
      )
    } else if (!tailwindResolvedInstance && tailwindPresent) {
      // Declared and found nowhere in the project: say what installs it.
      tailwindMissing = true
      opts.warn?.(
        messages.tailwindNotInstalled(
          projectPath,
          tailwindInstallFix(projectPath, declaredTailwindMajor)
        )
      )
    }
  }

  // Project-first plugin resolution: when the user's config is parseable, load
  // it here and resolve string plugins against the project, bypassing postcss-loader.
  let selfResolved: {plugins: AnyModule[]; unresolved: string[]} | undefined

  try {
    let configObject: AnyModule

    if (packageJsonConfigWins) {
      configObject = pkgPostCssConfig
    } else if (userPostCssConfig) {
      configObject = fileConfigObject
    }

    if (configObject?.plugins) {
      selfResolved = resolveConfigPluginList(configObject.plugins, {
        projectPath,
        configDir: userPostCssConfig
          ? path.dirname(userPostCssConfig)
          : undefined,
        tailwindInstance: tailwindResolvedInstance,
        bailOnFunctionEntries: userConfigUsesDirectTailwindReference
      })
    }
  } catch {
    selfResolved = undefined
  }

  if (selfResolved) {
    for (const pluginName of selfResolved.unresolved) {
      // Said above, with the command that installs it.
      if (tailwindMissing && TAILWIND_PLUGIN_IDS.includes(pluginName)) continue

      report(
        messages.postCssPluginNotResolved(
          pluginName,
          projectPath,
          formatInstallHint(projectPath, [pluginName])
        ),
        console.error
      )
    }

    const postcssOptions = {
      cwd: projectPath,
      config: false,
      plugins: selfResolved.plugins
    }

    if (isDebug()) {
      try {
        debugLine(
          `${prefix('debug')} [extension.js:postcss] projectPath=%s selfResolvedPlugins=%d unresolved=%s`,
          projectPath,
          selfResolved.plugins.length,
          selfResolved.unresolved.join(',') || 'none'
        )
      } catch {
        // Logging must never break the build
      }
    }

    return {
      loader: resolvedPostCssLoader,
      options: {
        postcssOptions,
        sourceMap: opts.mode === 'development'
      }
    }
  }

  // In "type: module" projects a CJS-authored postcss.config.js fails to load;
  // bypass config loading and provide a minimal plugin chain.
  const bypassUserConfigForTailwindCompat =
    !!pluginsFromOptions &&
    !!userPostCssConfig &&
    userConfigMentionsTailwind &&
    userConfigUsesDirectTailwindReference

  if (userConfigIsCjsInEsm || bypassUserConfigForTailwindCompat) {
    try {
      if (hasDependency(projectPath, 'autoprefixer')) {
        const req = createRequire(path.join(projectPath, 'package.json'))
        const autoprefixerMod = req('autoprefixer')
        const autoprefixerPlugin =
          typeof autoprefixerMod === 'function'
            ? autoprefixerMod()
            : autoprefixerMod?.default &&
                typeof autoprefixerMod.default === 'function'
              ? autoprefixerMod.default()
              : undefined

        if (autoprefixerPlugin) {
          pluginsFromOptions = [
            ...(pluginsFromOptions || []),
            autoprefixerPlugin
          ]
        }
      }
    } catch {
      // Keep non-fatal behavior and let postcss-loader continue.
    }
  }

  // Let postcss-loader load the user's config; we only signal PostCSS use, point
  // it at the right project root, and optionally inject a pre-resolved Tailwind.
  // The found file goes over as is: the loader's own search order differs,
  // and a project that keeps two configs must not get the other one here.
  // A config that was set aside stays out, or the loader fails on it again.
  const postcssOptions: AnyModule = {
    cwd: projectPath,
    config:
      userConfigIsCjsInEsm || bypassUserConfigForTailwindCompat || configRefused
        ? false
        : (userPostCssConfig ?? projectPath)
  }

  if (pluginsFromOptions) {
    postcssOptions.plugins = pluginsFromOptions
  }

  if (isDebug()) {
    try {
      debugLine(
        `${prefix('debug')} [extension.js:postcss] projectPath=%s userPostCssConfig=%s pkgHasPostCss=%s tailwindPresent=%s`,
        projectPath,
        userPostCssConfig || 'none',
        pkgHasPostCss,
        tailwindPresent
      )

      const resolvedPluginsCount = Array.isArray(postcssOptions.plugins)
        ? postcssOptions.plugins.length
        : 0
      debugLine(
        `${prefix('debug')} [extension.js:postcss] resolvedPlugins=%d config=%s cwd=%s`,
        resolvedPluginsCount,
        String(postcssOptions.config),
        String(postcssOptions.cwd)
      )
    } catch {
      // Logging must never break the build
    }
  }

  return {
    loader: resolvedPostCssLoader,
    options: {
      postcssOptions,
      sourceMap: opts.mode === 'development'
    }
  }
}
