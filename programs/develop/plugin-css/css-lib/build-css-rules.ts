//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {RuleSetRule} from '@rspack/core'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import type {DevOptions} from '../../types'
import {commonStyleLoaders} from '../common-style-loaders'
import {createSassLoaderOptions} from '../css-tools/sass'

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
    missingTool?: 'sass' | 'less'
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
      : // Without the preprocessor installed, still route the files as CSS.
        // Chrome loads a manifest-declared `.scss` stylesheet by injecting
        // its raw text as CSS (dropping invalid rules), so with no rule here
        // the file used to fall through to rspack's default JS parser and
        // hard-fail a build the browser accepts. Shipping raw preprocessor
        // source is knowingly-broken CSS, so each file also emits a loud
        // install-the-compiler warning via the passthrough loader.
        [
          {
            test: /\.(sass|scss)$/,
            exclude: /\.module\.(sass|scss)$/,
            type: nonModuleType,
            loader: null,
            missingTool: 'sass' as const
          },
          {
            test: /\.module\.(sass|scss)$/,
            type: 'css/module',
            loader: null,
            missingTool: 'sass' as const
          }
        ]),
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
      : [
          {
            test: /\.less$/,
            exclude: /\.module\.less$/,
            type: nonModuleType,
            loader: null,
            missingTool: 'less' as const
          },
          {
            test: /\.module\.less$/,
            type: 'css/module',
            loader: null,
            missingTool: 'less' as const
          }
        ])
  ]

  return Promise.all(
    fileTypes.map(async ({test, exclude, type, loader, missingTool}) => {
      const use = loader
        ? await commonStyleLoaders(projectPath, {
            mode: mode as 'development' | 'production',
            // Bare loader name; rspack resolves it via `resolveLoader.modules`,
            // which includes extension-develop's node_modules as a fallback.
            loader,
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

      if (missingTool) {
        ;(use as Array<Record<string, unknown>>).push({
          loader: resolveDevelopDistFile('preprocessor-passthrough-loader')
        })
      }

      return {test, exclude, type, issuer, use} as RuleSetRule
    })
  )
}
