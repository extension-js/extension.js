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
import {pathToFileURL} from 'url'
import colors from 'pintor'
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

  // Optionally pre-resolve the Tailwind PostCSS plugin from the project/workspace
  // so postcss-loader never has to require("@tailwindcss/postcss") from the
  // extensionjs cache path when used via npm/npx.
  let pluginsFromOptions: any[] | undefined

  if (tailwindPresent) {
    try {
      const bases = [projectPath, process.cwd()]
      let tailwindMod: any | undefined
      let lastError: unknown

      for (const base of bases) {
        try {
          const req = createRequire(path.join(base, 'package.json'))
          tailwindMod = req('@tailwindcss/postcss')
          break
        } catch (e) {
          lastError = e
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
          tailwindMod = (tailwindMod as any).default
        }

        if (typeof tailwindMod === 'function') {
          // Factory form: plugin(options?) -> plugin object
          const instance = tailwindMod()
          pluginsFromOptions = [
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
          pluginsFromOptions = [{'@tailwindcss/postcss': false}, tailwindMod]
        }
      }
    } catch {
      // Never break the build from here; let postcss-loader handle errors.
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
    config: projectPath
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
