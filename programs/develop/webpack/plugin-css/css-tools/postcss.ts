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
  hasDependency
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

function isLikelyCjsTailwindConfigInEsmProject(
  projectPath: string,
  tailwindConfigPath?: string
): boolean {
  if (
    !tailwindConfigPath ||
    !tailwindConfigPath.endsWith('tailwind.config.js')
  ) {
    return false
  }

  if (!isTypeModuleProject(projectPath)) return false

  try {
    const text = fs.readFileSync(tailwindConfigPath, 'utf8')
    return /module\.exports|require\(/.test(text)
  } catch {
    return false
  }
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
  const userPostCssConfig = findPostCssConfig(projectPath)
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

  const {hasPostCss: pkgHasPostCss, config: pkgPostCssConfig} =
    getPackageJsonConfig(projectPath)
  const tailwindPresent = isUsingTailwind(projectPath)

  // Only add postcss-loader when there's a clear signal of usage
  if (!userPostCssConfig && !pkgHasPostCss && !tailwindPresent) {
    return {}
  }

  try {
    require.resolve('postcss-loader')
  } catch (_error) {
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

    console.log(messages.youAreAllSet('PostCSS'))
    process.exit(0)
  }

  // Optionally pre-resolve the Tailwind PostCSS plugin from the project/workspace
  // so postcss-loader never has to require("@tailwindcss/postcss") from the
  // extensionjs cache path when used via npm/npx.
  let pluginsFromOptions: any[] | undefined
  const hasTailwindPostCssDependency = hasDependency(
    projectPath,
    '@tailwindcss/postcss'
  )

  if (
    tailwindPresent &&
    (!userPostCssConfig || userConfigIsCjsInEsm) &&
    !pkgHasPostCss
  ) {
    try {
      const bases = [projectPath, process.cwd()]
      const pluginCandidates = hasTailwindPostCssDependency
        ? ['@tailwindcss/postcss', 'tailwindcss']
        : ['tailwindcss', '@tailwindcss/postcss']
      let tailwindMod: any | undefined
      let tailwindPluginId: string | undefined
      let lastError: unknown

      for (const base of bases) {
        try {
          const req = createRequire(path.join(base, 'package.json'))
          for (const id of pluginCandidates) {
            try {
              tailwindMod = req(id)
              tailwindPluginId = id
              break
            } catch {}
          }
          if (tailwindMod) break
        } catch (_error) {
          lastError = _error
        }
      }

      if (!tailwindMod && lastError) {
        // If resolution fails completely, fall back to postcss-loader's default
        // behavior so users still get the same error surface area.
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
                // Backward compatibility:
                // Support CJS tailwind.config.js in type=module projects without
                // requiring users to rename config files.
                if (
                  isLikelyCjsTailwindConfigInEsmProject(projectPath, configFile)
                ) {
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
            instance = tailwindMod()
          }

          pluginsFromOptions = userConfigIsCjsInEsm
            ? [instance]
            : [
                // Disable any string-configured "@tailwindcss/postcss" in user config,
                // so loadPlugin() won't try to require it from the loader path.
                {'@tailwindcss/postcss': false},
                instance
              ]
        } else if (
          tailwindMod &&
          typeof tailwindMod === 'object' &&
          'postcssPlugin' in tailwindMod
        ) {
          // Already a plugin object
          pluginsFromOptions = userConfigIsCjsInEsm
            ? [tailwindMod]
            : [{'@tailwindcss/postcss': false}, tailwindMod]
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
  if (userConfigIsCjsInEsm) {
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
    config: userConfigIsCjsInEsm ? false : projectPath
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
    loader: require.resolve('postcss-loader'),
    options: {
      postcssOptions,
      sourceMap: opts.mode === 'development'
    }
  }
}
