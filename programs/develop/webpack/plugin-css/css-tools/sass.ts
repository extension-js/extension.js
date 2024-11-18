import path from 'path'
import fs from 'fs'
import {commonStyleLoaders} from '../common-style-loaders'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {DevOptions} from '../../../commands/commands-lib/config-types'

let userMessageDelivered = false

export function isUsingSass(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const sassAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.sass
  const sassAsDep = packageJson.dependencies && packageJson.dependencies.sass

  if (sassAsDevDep || sassAsDep) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration('SASS'))
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

type Loader = Record<string, any>

export async function maybeUseSass(
  projectPath: string,
  mode: DevOptions['mode']
): Promise<Loader[]> {
  if (!isUsingSass(projectPath)) return []

  try {
    require.resolve('sass-loader')
  } catch (e) {
    const postCssDependencies = [
      'postcss-loader',
      'postcss-scss',
      'postcss-flexbugs-fixes',
      'postcss-preset-env',
      'postcss-normalize'
    ]

    await installOptionalDependencies('PostCSS', postCssDependencies)

    const sassDependencies = ['sass', 'sass-loader', 'resolve-url-loader']

    await installOptionalDependencies('SASS', sassDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('SASS'))
    process.exit(0)
  }

  return [
    {
      test: /\.(s(a|c)ss)$/,
      exclude: /\.module\.(s(a|c)ss)$/,
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          use: await commonStyleLoaders(projectPath, {
            loader: 'sass-loader',
            mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: await commonStyleLoaders(projectPath, {
            loader: 'sass-loader',
            mode,
            useMiniCssExtractPlugin: mode === 'production'
          })
        }
      ]
    },
    {
      test: /\.module\.(s(a|c)ss)$/,
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          use: await commonStyleLoaders(projectPath, {
            loader: 'sass-loader',
            mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: await commonStyleLoaders(projectPath, {
            loader: 'sass-loader',
            mode,
            useMiniCssExtractPlugin: mode === 'production'
          })
        }
      ]
    }
  ]
}
