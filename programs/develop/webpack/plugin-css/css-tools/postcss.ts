// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import * as messages from '../css-lib/messages'
import {isUsingTailwind} from './tailwind'
import {isUsingSass} from './sass'
import {isUsingLess} from './less'
import {
  installOptionalDependencies,
  hasDependency
} from '../css-lib/integrations'
import type {StyleLoaderOptions} from '../common-style-loaders'

let userMessageDelivered = false

const postCssConfigFiles = [
  '.postcssrc',
  '.postcssrc.json',
  '.postcssrc.yaml',
  '.postcssrc.yml',
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
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration('PostCSS'))
      }

      userMessageDelivered = true
    }
    return true
  }

  if (findPostCssConfig(projectPath)) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration('PostCSS'))
      }

      userMessageDelivered = true
    }

    return true
  }

  if (isUsingTailwind(projectPath)) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
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

  return {
    test: /\.css$/,
    type: 'css',
    loader: require.resolve('postcss-loader'),
    options: {
      postcssOptions: {
        ident: 'postcss',
        config: userPostCssConfig,
        // If the user has their own PostCSS config, defer entirely to it.
        // Otherwise, apply a sensible default with postcss-preset-env.
        plugins: userPostCssConfig
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
