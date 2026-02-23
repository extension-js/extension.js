//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import colors from 'pintor'
import * as messages from '../css-lib/messages'
import {
  installOptionalDependencies,
  hasDependency,
  resolveDevelopInstallRoot
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

function resolveLessLoader(projectPath: string): string | undefined {
  const extensionRoot = resolveDevelopInstallRoot()
  const paths = [projectPath, extensionRoot || undefined, process.cwd()].filter(
    Boolean
  ) as string[]
  try {
    return require.resolve('less-loader', {paths})
  } catch {
    return undefined
  }
}

export async function maybeUseLess(
  projectPath: string,
  manifestPath: string
): Promise<Loader[]> {
  const resolvedManifestPath =
    manifestPath || path.join(projectPath, 'manifest.json')

  if (!isUsingLess(projectPath)) return []

  let lessLoaderPath = resolveLessLoader(projectPath)

  if (!lessLoaderPath) {
    const lessDependencies = ['less', 'less-loader']

    const didInstall = await installOptionalDependencies(
      'LESS',
      lessDependencies
    )

    if (!didInstall) {
      throw new Error('[LESS] Optional dependencies failed to install.')
    }

    lessLoaderPath = resolveLessLoader(projectPath)
    if (!lessLoaderPath) {
      throw new Error(
        '[LESS] less-loader could not be resolved after optional dependency installation.'
      )
    }
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.youAreAllSet('LESS'))
    }
  }

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
