import * as path from 'path'
import * as fs from 'fs'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {isContentScriptEntry} from '../is-content-script'
import {getDirname} from '../../../dirname'

const __dirname = getDirname(import.meta.url)

let userMessageDelivered = false

export function isUsingLess(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
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
  const manifestPath = path.join(projectPath, 'manifest.json')

  if (!isUsingLess(projectPath)) return []

  try {
    // @ts-expect-error - less-loader is not typed
    await import('less-loader')
  } catch (e) {
    const lessDependencies = ['less', 'less-loader']

    await installOptionalDependencies('LESS', lessDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('LESS'))
    process.exit(0)
  }

  const lessLoaderPath = path.resolve(
    __dirname,
    '..',
    'node_modules',
    'less-loader'
  )

  return [
    // Regular .less files
    {
      test: /\.less$/,
      exclude: /\.module\.less$/,
      type: 'css',
      use: [
        {
          loader: lessLoaderPath,
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
          loader: lessLoaderPath,
          options: {
            sourceMap: true
          }
        }
      ]
    },
    {
      test: /\.less$/,
      exclude: /\.module\.less$/,
      type: 'asset/resource',
      issuer: (issuer: string) => isContentScriptEntry(issuer, manifestPath)
    }
  ]
}
