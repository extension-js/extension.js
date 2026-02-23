//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {createRequire} from 'module'
import colors from 'pintor'
import * as messages from '../css-lib/messages'
import {
  installOptionalDependencies,
  hasDependency,
  resolveDevelopInstallRoot
} from '../css-lib/integrations'
import {isUsingTailwind, getTailwindConfigFile} from './tailwind'
import {isUsingSass} from './sass'
import {isUsingLess} from './less'
import type {StyleLoaderOptions} from '../common-style-loaders'

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

function findPostCssConfig(projectPath: string): string | undefined {
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

    // Best-effort detection for common config styles:
    // - JS/CJS/MJS: plugins: {'@tailwindcss/postcss': {}}
    // - JS/CJS/MJS: plugins: [require('tailwindcss')]
    // - JSON/YAML rc: "@tailwindcss/postcss" / "tailwindcss"
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
    // - const tailwindcss = require('tailwindcss')
    // - plugins: [tailwindcss, ...]
    // - plugins: [require('tailwindcss'), ...]
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

function tryLoadCjsConfig(configPath: string): any | undefined {
  try {
    const source = fs.readFileSync(configPath, 'utf8')
    const moduleObj: {exports: any} = {exports: {}}
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

function normalizeTailwindContentGlobs(config: any, projectPath: string): any {
  if (!config || typeof config !== 'object') return config

  const normalizeEntry = (entry: any) => {
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
    const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw || '{}')
    const version =
      pkg?.dependencies?.tailwindcss || pkg?.devDependencies?.tailwindcss
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
          `${colors.brightMagenta('►►► Author says')} ${messages.isUsingIntegration('PostCSS')}`
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
          `${colors.brightMagenta('►►► Author says')} ${messages.isUsingIntegration('PostCSS')}`
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
          `${colors.brightMagenta('►►► Author says')} ${messages.isUsingIntegration('PostCSS')}`
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
): Promise<Record<string, any>> {
  const getResolutionPaths = () => {
    const extensionRoot = resolveDevelopInstallRoot()
    const paths = [
      projectPath,
      extensionRoot || undefined,
      process.cwd()
    ].filter(Boolean) as string[]
    return Array.from(new Set(paths))
  }

  const resolveWithCreateRequire = (id: string) => {
    const bases = getResolutionPaths()
    for (const base of bases) {
      try {
        const req = createRequire(path.join(base, 'package.json'))
        return req.resolve(id)
      } catch {
        // Try next base
      }
    }
    return undefined
  }

  const resolvePostCssLoader = () => {
    const fromRuntimeRequire = resolveWithCreateRequire('postcss-loader')
    if (fromRuntimeRequire) return fromRuntimeRequire

    try {
      return require.resolve('postcss-loader', {
        paths: getResolutionPaths()
      })
    } catch {
      return undefined
    }
  }

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
    config?: any
  } {
    try {
      const raw = fs.readFileSync(path.join(p, 'package.json'), 'utf8')
      const pkg = JSON.parse(raw || '{}')
      return {hasPostCss: !!pkg?.postcss, config: pkg?.postcss}
    } catch {
      return {hasPostCss: false}
    }
  }

  const {hasPostCss: pkgHasPostCss} = getPackageJsonConfig(projectPath)
  const tailwindPresent = isUsingTailwind(projectPath)
  const tailwindConfigured = tailwindPresent || userConfigMentionsTailwind

  // Only add postcss-loader when there's a clear signal of usage
  if (!userPostCssConfig && !pkgHasPostCss && !tailwindPresent) {
    return {}
  }

  let resolvedPostCssLoader = resolvePostCssLoader()

  if (!resolvedPostCssLoader) {
    // SASS and LESS will install PostCSS as a dependency
    // so we don't need to check for it here.
    if (!isUsingSass(projectPath) && !isUsingLess(projectPath)) {
      const postCssDependencies = ['postcss', 'postcss-loader']

      const didInstall = await installOptionalDependencies(
        'PostCSS',
        postCssDependencies
      )

      if (!didInstall) {
        throw new Error('[PostCSS] Optional dependencies failed to install.')
      }
    }

    resolvedPostCssLoader = resolvePostCssLoader()

    if (!resolvedPostCssLoader) {
      throw new Error(
        '[PostCSS] postcss-loader could not be resolved after optional dependency installation.'
      )
    }

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.youAreAllSet('PostCSS'))
    }
  }

  // Optionally pre-resolve the Tailwind PostCSS plugin from the project/workspace
  // so postcss-loader never has to require("@tailwindcss/postcss") from the
  // extensionjs cache path when used via npm/npx.
  let pluginsFromOptions: any[] | undefined
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
      let tailwindMod: any | undefined
      let tailwindPluginId: string | undefined
      for (const base of bases) {
        try {
          const req = createRequire(path.join(base, '__extensionjs__.js'))
          for (const id of pluginCandidates) {
            try {
              tailwindMod = req(id)
              tailwindPluginId = id
              break
            } catch {}
          }
          if (tailwindMod) break
        } catch {
          // Try next base
        }
      }

      if (tailwindMod) {
        // Unwrap ESM default export if present
        if (
          tailwindMod &&
          typeof tailwindMod === 'object' &&
          'default' in tailwindMod
        ) {
          tailwindMod = tailwindMod.default
        }

        if (typeof tailwindMod === 'function') {
          // Factory form: plugin(options?) -> plugin object
          let instance: any

          try {
            // v4 plugin supports {base}; v3 plugin should receive {config}
            // to preserve user theme/content tokens like border-border.
            if (tailwindPluginId === 'tailwindcss') {
              const configFile = getTailwindConfigFile(projectPath)
              if (configFile) {
                // Load CJS config to normalize relative `content` globs against
                // the extension project path. This avoids cwd-dependent misses in
                // monorepos while preserving JS/CJS compatibility.
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
              // Recovery path:
              // If direct tailwindcss plugin execution fails (e.g. v4 package),
              // try loading @tailwindcss/postcss and anchor it to project root.
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
                    // keep trying fallback bases
                  }
                }
              }
            }
          }

          if (instance) {
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
          // Already a plugin object
          pluginsFromOptions = userConfigIsCjsInEsm
            ? [tailwindMod]
            : [...tailwindStringPluginDisableShims(), tailwindMod]
        }
      }
    } catch {
      // Never break the build from here; let postcss-loader handle errors.
    }
  }

  // Compatibility fallback:
  // In "type: module" projects, postcss.config.js authored in CJS syntax
  // (module.exports / require) fails when postcss-loader tries to load config.
  // In this case, bypass config loading and provide a minimal plugin chain.
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

  // Let postcss-loader handle loading the user's config and remaining plugins.
  // We only:
  // - signal that PostCSS is in use (via the guards above),
  // - point postcss-loader at the correct project root for config discovery, and
  // - optionally inject a pre-resolved Tailwind plugin instance.
  const postcssOptions: any = {
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

  // Debug logging for published/npm scenarios (opt-in via EXTENSION_AUTHOR_MODE)
  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    try {
      // Keep logs concise but informative for real-world debugging
      console.log(
        `${colors.brightMagenta('►►► Author says')} [extension.js:postcss] projectPath=%s userPostCssConfig=%s pkgHasPostCss=%s tailwindPresent=%s`,
        projectPath,
        userPostCssConfig || 'none',
        pkgHasPostCss,
        tailwindPresent
      )
      const resolvedPluginsCount = Array.isArray(postcssOptions.plugins)
        ? postcssOptions.plugins.length
        : 0
      console.log(
        `${colors.brightMagenta('►►► Author says')} [extension.js:postcss] resolvedPlugins=%d config=%s cwd=%s`,
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
