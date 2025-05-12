import path from 'path'
import fs from 'fs'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {isContentScriptEntry} from '../is-content-script'
import {getDirname} from '../../../dirname'

const __dirname = getDirname(import.meta.url)

let userMessageDelivered = false

export function isUsingSass(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
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

export async function maybeUseSass(projectPath: string): Promise<Loader[]> {
  const manifestPath = path.join(projectPath, 'manifest.json')

  if (!isUsingSass(projectPath)) return []

  try {
    await import('sass-loader')
  } catch (e) {
    const postCssDependencies = [
      'postcss-loader',
      'postcss-scss',
      'postcss-preset-env'
    ]

    await installOptionalDependencies('PostCSS', postCssDependencies)

    const sassDependencies = ['sass', 'sass-loader']

    await installOptionalDependencies('SASS', sassDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('SASS'))
    process.exit(0)
  }

  const sassLoaderPath = path.resolve(
    __dirname,
    '..',
    'node_modules',
    'sass-loader'
  )

  return [
    // Regular .sass/.scss files
    {
      test: /\.(sass|scss)$/,
      exclude: /\.module\.(sass|scss)$/,
      type: 'css',
      use: [
        {
          loader: sassLoaderPath,
          options: {
            sourceMap: true,
            sassOptions: {
              outputStyle: 'expanded'
            }
          }
        }
      ]
    },
    // Module .sass/.scss files
    {
      test: /\.module\.(sass|scss)$/,
      type: 'css/module',
      use: [
        {
          loader: sassLoaderPath,
          options: {
            sourceMap: true,
            sassOptions: {
              outputStyle: 'expanded'
            }
          }
        }
      ]
    },
    {
      test: /\.(sass|scss)$/,
      exclude: /\.module\.(sass|scss)$/,
      type: 'asset/resource',
      issuer: (issuer: string) => isContentScriptEntry(issuer, manifestPath)
    }
  ]
}
