//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import colors from 'pintor'
import * as messages from '../css-lib/messages'
import {hasDependency} from '../css-lib/integrations'
import {isContentScriptEntry} from '../css-lib/is-content-script'
import {ensureOptionalPackageResolved} from '../../webpack-lib/optional-deps-resolver'

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

  const lessLoaderPath = await ensureOptionalPackageResolved({
    integration: 'LESS',
    projectPath,
    dependencyId: 'less-loader',
    installDependencies: ['less', 'less-loader'],
    verifyPackageIds: ['less', 'less-loader']
  })

  return [
    // Regular .less files
    {
      test: /\.less$/,
      exclude: /\.module\.less$/,
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
      generator: {filename: 'content_scripts/[name].[contenthash:8].css'},
      issuer: (issuer: string) =>
        isContentScriptEntry(issuer, resolvedManifestPath, projectPath)
    }
  ]
}
