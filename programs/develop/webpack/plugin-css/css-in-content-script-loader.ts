//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {commonStyleLoaders} from './common-style-loaders'
import {isContentScriptEntry} from './css-lib/is-content-script'
import {createSassLoaderOptions} from './css-tools/sass'
import type {DevOptions} from '../webpack-types'

interface PreprocessorUsage {
  useSass?: boolean
  useLess?: boolean
}

export async function cssInContentScriptLoader(
  projectPath: string,
  manifestPath: string,
  mode: DevOptions['mode'],
  usage: PreprocessorUsage = {}
) {
  const {useSass = true, useLess = true} = usage
  const isContentScript = (issuer: string) =>
    isContentScriptEntry(issuer, manifestPath, projectPath)

  // Define file type configurations
  const fileTypes = [
    {test: /\.module\.css$/, type: 'css/module' as const, loader: null},
    {
      test: /\.css$/,
      exclude: /\.module\.css$/,
      type: 'asset' as const,
      loader: null
    },
    ...(useSass
      ? [
          {
            test: /\.(sass|scss)$/,
            exclude: /\.module\.(sass|scss)$/,
            type: 'asset' as const,
            loader: 'sass-loader'
          },
          {
            test: /\.module\.(sass|scss)$/,
            type: 'css/module' as const,
            loader: 'sass-loader'
          }
        ]
      : []),
    ...(useLess
      ? [
          {
            test: /\.less$/,
            exclude: /\.module\.less$/,
            type: 'asset' as const,
            loader: 'less-loader'
          },
          {
            test: /\.module\.less$/,
            type: 'css/module' as const,
            loader: 'less-loader'
          }
        ]
      : [])
  ]

  const rules = await Promise.all(
    fileTypes.map(async ({test, exclude, type = 'asset', loader}) => {
      const baseConfig: Record<string, any> = {
        test,
        exclude,
        type,
        issuer: isContentScript
      }
      if (type === 'asset') {
        baseConfig.generator = {
          filename: 'content_scripts/[name].[contenthash:8].css'
        }
      }

      if (!loader) {
        // Regular CSS - no preprocessor needed
        return {
          ...baseConfig,
          use: await commonStyleLoaders(projectPath, {
            mode: mode as 'development' | 'production'
          })
        }
      }

      // Preprocessor CSS
      const loaderOptions =
        loader === 'sass-loader'
          ? createSassLoaderOptions(
              projectPath,
              mode as 'development' | 'production'
            )
          : {sourceMap: true}

      return {
        ...baseConfig,
        use: await commonStyleLoaders(projectPath, {
          mode: mode as 'development' | 'production',
          loader: require.resolve(loader),
          loaderOptions
        })
      }
    })
  )

  return rules
}
