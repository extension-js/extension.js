// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import {createRequire} from 'module'
import {pathToFileURL} from 'url'
import * as messages from '../css-lib/messages'
import {
  installOptionalDependencies,
  hasDependency
} from '../css-lib/integrations'
import {isUsingTailwind} from './tailwind'
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
  for (const configFile of postCssConfigFiles) {
    const configPath = path.join(projectPath, configFile)
    if (fs.existsSync(configPath)) {
      return configPath
    }
  }
  return undefined
}

export function isUsingPostCss(projectPath: string): boolean {
  if (hasDependency(projectPath, 'postcss')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.isUsingIntegration('PostCSS'))
      }

      userMessageDelivered = true
    }
    return true
  }

  if (findPostCssConfig(projectPath)) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.isUsingIntegration('PostCSS'))
      }

      userMessageDelivered = true
    }

    return true
  }

  if (isUsingTailwind(projectPath)) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.isUsingIntegration('PostCSS'))
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
  } catch (e) {
    // SASS and LESS will install PostCSS as a dependency
    // so we don't need to check for it here.
    if (!isUsingSass(projectPath) && !isUsingLess(projectPath)) {
      const postCssDependencies = ['postcss', 'postcss-loader']

      await installOptionalDependencies('PostCSS', postCssDependencies)
    }

    console.log(messages.youAreAllSet('PostCSS'))
    process.exit(0)
  }

  // Resolve the project's own PostCSS implementation to avoid resolving from the toolchain
  function getProjectPostcssImpl(): any {
    try {
      const req = createRequire(path.join(projectPath, 'package.json'))
      return req('postcss')
    } catch {
      try {
        // Fallback to loader's postcss if not found in project
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('postcss')
      } catch {
        return undefined
      }
    }
  }

  // Try to load user's PostCSS config (file or package.json postcss) and resolve plugins
  let plugins: any[] | undefined
  const reqFromProject = createRequire(path.join(projectPath, 'package.json'))

  async function loadConfigFromFile(
    configPath: string
  ): Promise<any | undefined> {
    try {
      if (configPath.endsWith('.mjs') || configPath.endsWith('.mts')) {
        const url = pathToFileURL(configPath).href
        const mod = await import(url)
        return mod?.default ?? mod
      }
      const req = createRequire(configPath)
      return req(configPath)
    } catch {
      return undefined
    }
  }

  let rawConfig: any | undefined

  if (userPostCssConfig) {
    rawConfig = await loadConfigFromFile(userPostCssConfig)
  } else if (pkgHasPostCss && pkgPostCssConfig) {
    rawConfig = pkgPostCssConfig
  }

  const configPlugins = rawConfig?.plugins

  if (Array.isArray(configPlugins)) {
    // Array form: [plugin, options] | plugin
    plugins = configPlugins
      .map((entry: any) => {
        try {
          if (typeof entry === 'function') return entry
          if (Array.isArray(entry)) {
            const [plugin, options] = entry
            if (typeof plugin === 'function') return plugin(options)
            if (typeof plugin === 'string') {
              const mod = reqFromProject(plugin)
              return typeof mod === 'function' ? mod(options) : mod
            }
          }
          return undefined
        } catch {
          return undefined
        }
      })
      .filter(Boolean)
  } else if (configPlugins && typeof configPlugins === 'object') {
    // Object form: { 'plugin-name': options | true | false }
    plugins = Object.entries(configPlugins)
      .map(([plugin, options]) => {
        if (options === false) return undefined
        try {
          const mod =
            typeof plugin === 'string'
              ? reqFromProject(plugin)
              : (plugin as any)
          if (typeof mod === 'function') {
            return options === true || typeof options === 'undefined'
              ? mod()
              : mod(options)
          }
          return mod
        } catch {
          return undefined
        }
      })
      .filter(Boolean)
  }

  const postcssOptions: any = {
    ident: 'postcss',
    cwd: projectPath
  }

  if (plugins && plugins.length) {
    // We already have real plugin functions; don't let postcss-loader reload config or plugins.
    postcssOptions.config = false
    postcssOptions.plugins = plugins
  } else {
    // Let postcss-loader discover config/plugins from the project root as a fallback.
    postcssOptions.config = projectPath
  }

  // Debug logging for published/npm scenarios (opt-in via EXTENSION_AUTHOR_MODE)
  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    try {
      // Keep logs concise but informative for real-world debugging
      console.log(
        '[extension.js:postcss] projectPath=%s userPostCssConfig=%s pkgHasPostCss=%s tailwindPresent=%s',
        projectPath,
        userPostCssConfig || 'none',
        pkgHasPostCss,
        tailwindPresent
      )
      console.log(
        '[extension.js:postcss] resolvedPlugins=%d config=%s cwd=%s',
        Array.isArray(plugins) ? plugins.length : 0,
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
      // Prefer the project's PostCSS implementation so plugins resolve from the project
      implementation: getProjectPostcssImpl(),
      postcssOptions,
      sourceMap: opts.mode === 'development'
    }
  }
}
