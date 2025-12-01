// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import {createRequire} from 'module'
import * as messages from '../../css-lib/messages'
import {
  installOptionalDependencies,
  hasDependency
} from '../../css-lib/integrations'
import {isUsingTailwind} from '../tailwind'
import {isUsingSass} from '../sass'
import {isUsingLess} from '../less'
import type {StyleLoaderOptions} from '../../common-style-loaders'
import {loadPluginsFromUserConfig} from './load-plugins-from-user-config'

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
  if (!isUsingPostCss(projectPath)) return {}

  const userPostCssConfig = findPostCssConfig(projectPath)

  function hasPostCssInPackageJson(p: string): boolean {
    try {
      const raw = fs.readFileSync(path.join(p, 'package.json'), 'utf8')
      const pkg = JSON.parse(raw || '{}')
      return !!pkg?.postcss
    } catch {
      return false
    }
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

  try {
    require.resolve('postcss-loader')
  } catch (e) {
    // SASS and LESS will install PostCSS as a dependency
    // so we don't need to check for it here.
    if (!isUsingSass(projectPath) && !isUsingLess(projectPath)) {
      const postCssDependencies = userPostCssConfig
        ? ['postcss', 'postcss-loader']
        : ['postcss', 'postcss-loader', 'postcss-preset-env']

      await installOptionalDependencies('PostCSS', postCssDependencies)
    }

    console.log(messages.youAreAllSet('PostCSS'))
    process.exit(0)
  }

  const pkgHasPostCss = hasPostCssInPackageJson(projectPath)
  const loadedPlugins = await loadPluginsFromUserConfig(
    projectPath,
    userPostCssConfig,
    opts.mode
  )
  const useUserConfig = !!userPostCssConfig || pkgHasPostCss

  return {
    test: /\.css$/,
    type: 'css',
    loader: require.resolve('postcss-loader'),
    options: {
      // Prefer the project's PostCSS implementation so plugins resolve from the project
      implementation: getProjectPostcssImpl(),
      postcssOptions: {
        ident: 'postcss',
        // Ensure resolution happens from the project root, never the toolchain/cache
        cwd: projectPath,
        // If we successfully loaded a file config, disable rediscovery and pass plugins directly.
        // Else if there's a package.json "postcss", allow discovery starting from the project path.
        // Otherwise disable config discovery and fall back to defaults.
        config: loadedPlugins ? false : useUserConfig ? projectPath : false,
        // If the user has a config (file or package.json), let it drive plugins.
        // When we loaded a file config ourselves, provide the normalized plugins explicitly.
        // Otherwise, provide a default preset.
        plugins:
          loadedPlugins !== undefined
            ? loadedPlugins
            : useUserConfig
              ? []
              : [
                  [
                    'postcss-preset-env',
                    {
                      autoprefixer: {
                        flexbox: 'no-2009'
                      },
                      stage: 3
                    }
                  ]
                ].filter(Boolean)
      },
      sourceMap: opts.mode === 'development'
    }
  }
}
