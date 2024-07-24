import path from 'path'
import fs from 'fs'
import {execSync} from 'child_process'
import {commonStyleLoaders} from '../common-style-loaders'
import {DevOptions} from '../../../develop-types'
import * as messages from '../../lib/messages'

let userMessageDelivered = false

export function isUsingSass(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const sassAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.sass
  const sassAsDep = packageJson.dependencies && packageJson.dependencies.sass

  if (sassAsDevDep || sassAsDep) {
    if (!userMessageDelivered) {
      const manifest = require(manifestJsonPath)
      console.log(messages.isUsingTechnology(manifest, 'SASS'))

      userMessageDelivered = true
    }
    return true
  }

  return false
}

function installSass() {
  console.log('Sass is not installed. Installing...')
  execSync('npm install sass', {stdio: 'inherit'})
  console.log('Sass and related loaders installed successfully.')
}

type Loader = Record<string, any>

export function maybeUseSass(
  projectPath: string,
  mode: DevOptions['mode']
): Loader[] {
  if (!isUsingSass(projectPath)) return []
  // try {
  //   require.resolve('sass')
  // } catch (e) {
  //   installSass()
  // }

  return [
    {
      test: /\.(scss|sass)$/,
      exclude: /\.module\.css$/,
      // https://stackoverflow.com/a/60482491/4902448
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          use: commonStyleLoaders(projectPath, {
            regex: /\.(scss|sass)$/,
            loader: require.resolve('sass-loader'),
            mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: commonStyleLoaders(projectPath, {
            regex: /\.(scss|sass)$/,
            loader: require.resolve('sass-loader'),
            mode,
            useMiniCssExtractPlugin: true
          })
        }
      ]
    },
    {
      test: /\.module\.(scss|sass)$/,
      // https://stackoverflow.com/a/60482491/4902448
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          use: commonStyleLoaders(projectPath, {
            regex: /\.(scss|sass)$/,
            loader: require.resolve('sass-loader'),
            mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: commonStyleLoaders(projectPath, {
            regex: /\.(scss|sass)$/,
            loader: require.resolve('sass-loader'),
            mode,
            useMiniCssExtractPlugin: true
          })
        }
      ],
      use: commonStyleLoaders(projectPath, {
        regex: /\.module\.(scss|sass)$/,
        loader: require.resolve('sass-loader'),
        mode,
        useMiniCssExtractPlugin: true
      })
    }
  ]
}
