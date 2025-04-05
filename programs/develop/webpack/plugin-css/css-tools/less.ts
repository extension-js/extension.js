import path from 'path'
import fs from 'fs'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'

let userMessageDelivered = false

export function isUsingLess(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')

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
        console.log(messages.isUsingIntegration('LESS'))
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

type Loader = Record<string, any>

export async function maybeUseLess(projectPath: string): Promise<Loader[]> {
  if (!isUsingLess(projectPath)) return []

  try {
    require.resolve('less-loader')
  } catch (e) {
    const lessDependencies = ['less', 'less-loader']

    await installOptionalDependencies('LESS', lessDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('LESS'))
    process.exit(0)
  }

  return [
    // Regular .less files
    {
      test: /\.less$/,
      exclude: /\.module\.less$/,
      type: 'css',
      use: [
        {
          loader: require.resolve('less-loader'),
          options: {
            sourceMap: true
          }
        }
      ]
    },
    // Module .less files
    {
      test: /\.module\.less$/,
      type: 'css/module',
      use: [
        {
          loader: require.resolve('less-loader'),
          options: {
            sourceMap: true
          }
        }
      ]
    }
  ]
}
