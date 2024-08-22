import path from 'path'
import fs from 'fs'
import {commonStyleLoaders} from '../common-style-loaders'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {DevOptions} from '../../../commands/dev'
import {Manifest} from '../../webpack-types'

let userMessageDelivered = false

export function isUsingLess(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')
  const manifest: Manifest = require(manifestJsonPath)
  const manifestName = manifest.name || 'Extension.js'

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const lessAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.less
  const lessAsDep = packageJson.dependencies && packageJson.dependencies.less

  if (lessAsDevDep || lessAsDep) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration(manifestName, 'LESS'))
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

type Loader = Record<string, any>

export async function maybeUseLess(
  projectPath: string,
  mode: DevOptions['mode']
): Promise<Loader[]> {
  if (!isUsingLess(projectPath)) return []

  try {
    require.resolve('less-loader')
  } catch (e) {
    const projectName = require(path.join(projectPath, 'package.json')).name

    const lessDependencies = ['less', 'less-loader', 'resolve-url-loader']

    await installOptionalDependencies(projectName, 'LESS', lessDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet(projectName, 'LESS'))
    process.exit(0)
  }

  return [
    {
      test: /\.less$/,
      // Set to 'css/auto' if you want to support '*.module.less' as CSS Modules, otherwise set type to 'css'
      type: 'css/auto',
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          use: await commonStyleLoaders(projectPath, {
            loader: 'less-loader',
            mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: await commonStyleLoaders(projectPath, {
            loader: 'less-loader',
            mode,
            useMiniCssExtractPlugin: mode === 'production'
          })
        }
      ]
    },
    {
      test: /\.module\.(s(a|c)ss)$/,
      // Set to 'css/auto' if you want to support '*.module.less' as CSS Modules, otherwise set type to 'css'
      type: 'css/auto',
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          type: 'javascript/auto',
          use: await commonStyleLoaders(projectPath, {
            loader: 'less-loader',
            mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: await commonStyleLoaders(projectPath, {
            loader: 'less-loader',
            mode,
            useMiniCssExtractPlugin: true
          })
        }
      ]
    }
  ]
}
