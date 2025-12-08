import * as path from 'path'
import * as fs from 'fs'
import colors from 'pintor'
import * as messages from '../css-lib/messages'
import {
  installOptionalDependencies,
  hasDependency
} from '../css-lib/integrations'
import {isContentScriptEntry} from '../css-lib/is-content-script'

let userMessageDelivered = false

export function isUsingLess(projectPath: string): boolean {
  if (hasDependency(projectPath, 'less')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('►►► Author says')} ${messages.isUsingIntegration('LESS')}`
        )
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
  manifestPath: string
): Promise<Loader[]> {
  const resolvedManifestPath =
    manifestPath || path.join(projectPath, 'manifest.json')

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
      use: [
        {
          loader: require.resolve('less-loader'),
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
      generator: {filename: 'content_scripts/[name].[contenthash:8].css'},
      issuer: (issuer: string) =>
        isContentScriptEntry(issuer, resolvedManifestPath)
    }
  ]
}
