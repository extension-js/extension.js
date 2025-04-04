import path from 'path'
import fs from 'fs'
import {StyleLoaderOptions} from '../common-style-loaders'
import * as messages from '../../lib/messages'
import {isUsingTailwind} from './tailwind'
import {isUsingSass} from './sass'
import {isUsingLess} from './less'
import {installOptionalDependencies} from '../../lib/utils'

let userMessageDelivered = false

export function isUsingPostCss(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

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

  if (fs.existsSync(packageJsonPath)) {
    const packageJson = require(packageJsonPath)
    if (
      (packageJson.dependencies && packageJson.dependencies['postcss']) ||
      (packageJson.devDependencies && packageJson.devDependencies['postcss'])
    ) {
      if (!userMessageDelivered) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(messages.isUsingIntegration('PostCSS'))
        }

        userMessageDelivered = true
      }
      return true
    }
  }

  for (const configFile of postCssConfigFiles) {
    if (fs.existsSync(path.join(projectPath, configFile))) {
      if (!userMessageDelivered) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(messages.isUsingIntegration('PostCSS'))
        }

        userMessageDelivered = true
      }

      return true
    }
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

type Loader = Record<string, any>

export async function maybeUsePostCss(
  projectPath: string,
  opts: StyleLoaderOptions
): Promise<Loader> {
  if (!isUsingPostCss(projectPath)) return {}

  try {
    require.resolve('postcss-loader')
  } catch (e) {
    // SASS and LESS will install PostCSS as a dependency
    // so we don't need to check for it here.
    if (!isUsingSass(projectPath) && !isUsingLess(projectPath)) {
      const postCssDependencies = [
        'postcss',
        'postcss-loader',
        'postcss-preset-env'
      ]

      await installOptionalDependencies('PostCSS', postCssDependencies)
    }

    console.log(messages.youAreAllSet('PostCSS'))
    process.exit(0)
  }

  return {
    loader: require.resolve('postcss-loader'),
    options: {
      postcssOptions: {
        ident: 'postcss',
        config: path.resolve(projectPath, 'postcss.config.js'),
        plugins: [
          [
            require.resolve('postcss-preset-env'),
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
