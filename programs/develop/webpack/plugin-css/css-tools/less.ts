import path from 'path'
import fs from 'fs'
import {commonStyleLoaders} from '../common-style-loaders'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {DevOptions} from '../../../commands/dev'

let userMessageDelivered = false

export function isUsingLess(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const lessAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.less
  const lessAsDep = packageJson.dependencies && packageJson.dependencies.less

  if (lessAsDevDep || lessAsDep) {
    if (!userMessageDelivered) {
      const manifest = require(manifestJsonPath)
      console.log(messages.isUsingTechnology(manifest, 'LESS'))

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
    const lessDependencies = ['less', 'less-loader', 'resolve-url-loader']

    await installOptionalDependencies('LESS', lessDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('LESS'))
    process.exit(0)
  }

  return [
    {
      test: /\.less$/,
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
            useMiniCssExtractPlugin: true
          })
        }
      ]
    }
  ]
}
