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
import colors from 'pintor'
import {hasDependency} from '../../lib/has-dependency'
import type {AnyModule} from '../../lib/optional-deps-resolver'
import {ensureOptionalContractPackageResolved} from '../../lib/optional-deps-resolver'
import {readProjectDependencies} from '../../lib/project-manifest'
import type {StyleLoaderOptions} from '../common-style-loaders'
import * as messages from '../css-lib/messages'
import {getTailwindConfigFile, isUsingTailwind} from './tailwind'

let userMessageDelivered = false

const postCssConfigFiles = [
  '.postcssrc',
  '.postcssrc.json',
  '.postcssrc.yaml',
  '.postcssrc.yml',
  'postcss.config.mjs',
  '.postcssrc.js',
  '.postcssrc.cjs',
  'postcss.config.js',
  'postcss.config.cjs'
]

export function findPostCssConfig(projectPath: string): string | undefined {
  const ordered = isTypeModuleProject(projectPath)
    ? [
        '.postcssrc',
        '.postcssrc.json',
        '.postcssrc.yaml',
        '.postcssrc.yml',
        'postcss.config.mjs',
        '.postcssrc.cjs',
        'postcss.config.cjs',
        '.postcssrc.js',
        'postcss.config.js'
      ]
    : postCssConfigFiles

  for (const configFile of ordered) {
    const configPath = path.join(projectPath, configFile)

    if (fs.existsSync(configPath)) {
      return configPath
    }
  }

  return undefined
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

async function loadUserPostCssConfigObject(
  configPath: string,
  projectPath: string,
  mode: string
): Promise<AnyModule | undefined> {
  let loaded: AnyModule

  try {
    if (configPath.endsWith('.postcssrc') || configPath.endsWith('.json')) {
      loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } else if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
      // No YAML parser available here; let postcss-loader handle it.
      return undefined
    } else if (configPath.endsWith('.cjs')) {
      loaded = tryLoadCjsConfig(configPath)
    } else {
      try {
        const mod = await import(pathToFileURL(configPath).href)
        loaded = mod?.default ?? mod
      } catch {
        loaded = tryLoadCjsConfig(configPath)
      }
    }
  } catch {
    return undefined
  }

  if (typeof loaded === 'function') {
    try {
      loaded = loaded({env: mode, mode, cwd: projectPath})
    } catch {
      return undefined
    }
  }

  return loaded && typeof loaded === 'object' ? loaded : undefined
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

function tryLoadCjsConfig(configPath: string): AnyModule | undefined {
  try {
    const source = fs.readFileSync(configPath, 'utf8')
    const moduleObj: {exports: AnyModule} = {exports: {}}
    const exportsObj = moduleObj.exports
    const req = createRequire(configPath)
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
  } catch {
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

export function isUsingPostCss(projectPath: string): boolean {
  if (hasDependency(projectPath, 'postcss')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('⏵⏵⏵ Author says')} ${messages.isUsingIntegration('PostCSS')}`
        )
      }

      userMessageDelivered = true
    }
    return true
  }

  if (findPostCssConfig(projectPath)) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('⏵⏵⏵ Author says')} ${messages.isUsingIntegration('PostCSS')}`
        )
      }

      userMessageDelivered = true
    }

    return true
  }

  if (isUsingTailwind(projectPath)) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('⏵⏵⏵ Author says')} ${messages.isUsingIntegration('PostCSS')}`
        )
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

export async function maybeUsePostCss(
  projectPath: string,
  opts: StyleLoaderOptions
): Promise<Record<string, AnyModule>> {
  const userPostCssConfig = findPostCssConfig(projectPath)
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

  const {hasPostCss: pkgHasPostCss, config: pkgPostCssConfig} =
    getPackageJsonConfig(projectPath)
  const tailwindPresent = isUsingTailwind(projectPath)
  const tailwindConfigured = tailwindPresent || userConfigMentionsTailwind

  // Only add postcss-loader when there's a clear signal of usage
  if (!userPostCssConfig && !pkgHasPostCss && !tailwindPresent) {
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
    (!userPostCssConfig || userConfigIsCjsInEsm || userConfigMentionsTailwind)
  const declaredTailwindMajor = getDeclaredTailwindMajor(projectPath)

  if (shouldInjectTailwindPlugin) {
    try {
      const bases = Array.from(
        new Set(
          [
            projectPath,
            userPostCssConfig ? path.dirname(userPostCssConfig) : '',
            process.cwd()
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
      let tailwindPluginId: string | undefined
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
                  const loaded = tryLoadCjsConfig(configFile)

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
          } catch {
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
                    // Ignore
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
    } catch {
      // Never break the build from here; let postcss-loader handle errors.
    }
  }

  // Project-first plugin resolution: when the user's config is parseable, load
  // it here and resolve string plugins against the project, bypassing postcss-loader.
  let selfResolved: {plugins: AnyModule[]; unresolved: string[]} | undefined
  try {
    let configObject: AnyModule
    if (
      pkgHasPostCss &&
      pkgPostCssConfig &&
      typeof pkgPostCssConfig === 'object'
    ) {
      configObject = pkgPostCssConfig
    } else if (userPostCssConfig) {
      configObject = await loadUserPostCssConfigObject(
        userPostCssConfig,
        projectPath,
        String(opts.mode || 'development')
      )
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
      console.error(messages.postCssPluginNotResolved(pluginName, projectPath))
    }

    const postcssOptions = {
      ident: 'postcss',
      cwd: projectPath,
      config: false,
      plugins: selfResolved.plugins
    }

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      try {
        console.log(
          `${colors.brightMagenta('⏵⏵⏵ Author says')} [extension.js:postcss] projectPath=%s selfResolvedPlugins=%d unresolved=%s`,
          projectPath,
          selfResolved.plugins.length,
          selfResolved.unresolved.join(',') || 'none'
        )
      } catch {
        // Logging must never break the build
      }
    }

    return {
      test: /\.css$/,
      type: 'css',
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
  const postcssOptions: AnyModule = {
    ident: 'postcss',
    cwd: projectPath,
    config:
      userConfigIsCjsInEsm || bypassUserConfigForTailwindCompat
        ? false
        : projectPath
  }

  if (pluginsFromOptions) {
    postcssOptions.plugins = pluginsFromOptions
  }

  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    try {
      console.log(
        `${colors.brightMagenta('⏵⏵⏵ Author says')} [extension.js:postcss] projectPath=%s userPostCssConfig=%s pkgHasPostCss=%s tailwindPresent=%s`,
        projectPath,
        userPostCssConfig || 'none',
        pkgHasPostCss,
        tailwindPresent
      )
      const resolvedPluginsCount = Array.isArray(postcssOptions.plugins)
        ? postcssOptions.plugins.length
        : 0
      console.log(
        `${colors.brightMagenta('⏵⏵⏵ Author says')} [extension.js:postcss] resolvedPlugins=%d config=%s cwd=%s`,
        resolvedPluginsCount,
        String(postcssOptions.config),
        String(postcssOptions.cwd)
      )
    } catch {
      // Logging must never break the build
    }
  }

  return {
    test: /\.css$/,
    type: 'css',
    loader: resolvedPostCssLoader,
    options: {
      postcssOptions,
      sourceMap: opts.mode === 'development'
    }
  }
}
