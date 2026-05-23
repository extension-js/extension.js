//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║╚█████╗║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {RuleSetRule} from '@rspack/core'
import {commonStyleLoaders} from '../common-style-loaders'
import {createSassLoaderOptions} from '../css-tools/sass'
import {resolveOptionalDependencySync} from '../../lib/optional-deps-resolver'
import type {DevOptions} from '../../types'

export interface PreprocessorUsage {
  useSass?: boolean
  useLess?: boolean
}

interface BuildCssRulesOptions {
  // Module `type` for non-`.module` stylesheets. Content scripts inline their
  // CSS (`asset/inline`); HTML entries emit a real stylesheet (`css`)
  nonModuleType: 'asset/inline' | 'css'
  issuer: (issuer: string) => boolean
}

function resolvePreprocessorLoader(
  loader: 'sass-loader' | 'less-loader',
  projectPath: string
): string {
  return resolveOptionalDependencySync(loader, projectPath)
}

export async function buildCssRules(
  projectPath: string,
  mode: DevOptions['mode'],
  usage: PreprocessorUsage,
  opts: BuildCssRulesOptions
): Promise<RuleSetRule[]> {
  const {useSass = true, useLess = true} = usage
  const {nonModuleType, issuer} = opts

  const fileTypes: Array<{
    test: RegExp
    exclude?: RegExp
    type: string
    loader: 'sass-loader' | 'less-loader' | null
  }> = [
    {test: /\.module\.css$/, type: 'css/module', loader: null},
    {
      test: /\.css$/,
      exclude: /\.module\.css$/,
      type: nonModuleType,
      loader: null
    },
    ...(useSass
      ? [
          {
            test: /\.(sass|scss)$/,
            exclude: /\.module\.(sass|scss)$/,
            type: nonModuleType,
            loader: 'sass-loader' as const
          },
          {
            test: /\.module\.(sass|scss)$/,
            type: 'css/module',
            loader: 'sass-loader' as const
          }
        ]
      : []),
    ...(useLess
      ? [
          {
            test: /\.less$/,
            exclude: /\.module\.less$/,
            type: nonModuleType,
            loader: 'less-loader' as const
          },
          {
            test: /\.module\.less$/,
            type: 'css/module',
            loader: 'less-loader' as const
          }
        ]
      : [])
  ]

  return Promise.all(
    fileTypes.map(async ({test, exclude, type, loader}) => {
      const use = loader
        ? await commonStyleLoaders(projectPath, {
            mode: mode as 'development' | 'production',
            loader: resolvePreprocessorLoader(loader, projectPath),
            loaderOptions:
              loader === 'sass-loader'
                ? createSassLoaderOptions(
                    projectPath,
                    mode as 'development' | 'production'
                  )
                : {sourceMap: true}
          })
        : await commonStyleLoaders(projectPath, {
            mode: mode as 'development' | 'production'
          })

      return {test, exclude, type, issuer, use} as RuleSetRule
    })
  )
}
