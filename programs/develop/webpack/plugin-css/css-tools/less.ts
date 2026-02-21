//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {createRequire} from 'module'
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

export async function maybeUseLess(
  projectPath: string,
  manifestPath: string
): Promise<Loader[]> {
  const resolvedManifestPath =
    manifestPath || path.join(projectPath, 'manifest.json')

  if (!isUsingLess(projectPath)) return []

  const resolveLessLoaderPath = () => {
    try {
      return require.resolve('less-loader')
    } catch {
      // Try project/develop roots
    }
    try {
      const projectRequire = createRequire(
        path.join(projectPath, 'package.json')
      )

      return projectRequire.resolve('less-loader')
    } catch {
      // ignore
    }
    try {
      const developRoot =
        typeof resolveDevelopInstallRoot === 'function'
          ? resolveDevelopInstallRoot()
          : undefined

      if (!developRoot) return undefined
      const developRequire = createRequire(
        path.join(developRoot, 'package.json')
      )

      return developRequire.resolve('less-loader')
    } catch {
      return undefined
    }
  }

  let resolvedLessLoader = resolveLessLoaderPath()
  if (!resolvedLessLoader) {
    const lessDependencies = ['less', 'less-loader']

    const didInstall = await installOptionalDependencies(
      'LESS',
      lessDependencies
    )

    if (!didInstall) {
      throw new Error('[LESS] Optional dependencies failed to install.')
    }

    resolvedLessLoader = resolveLessLoaderPath()
    if (!resolvedLessLoader) {
      throw new Error(
        '[LESS] Dependencies were installed, but less-loader is still unavailable in this runtime.'
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
          loader: resolvedLessLoader,
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
          loader: resolvedLessLoader,
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
