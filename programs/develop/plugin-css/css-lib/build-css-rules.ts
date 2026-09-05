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
  // Set for inlined stylesheets, whose url() children never reach the module
  // graph. The sheet then leaves the loader chain as a JavaScript module that
  // resolves its url() targets at runtime, and its rule type follows.
  manifestPath?: string
}

export async function buildCssRules(
  projectPath: string,
  mode: DevOptions['mode'],
  usage: PreprocessorUsage,
  opts: BuildCssRulesOptions
): Promise<RuleSetRule[]> {
  const {useSass = true, useLess = true} = usage
  const {nonModuleType, issuer, manifestPath} = opts

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
        // Chrome loads a manifest-declared .scss by injecting raw text as CSS; without
        // this rule the file hits the JS parser and fails a build the browser accepts.
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

      // Runs last, right before rspack's native CSS parser, which fails the
      // module on an @import after other rules that browsers simply skip.
      // The parse guard pitches ahead of it in every project, PostCSS or
      // not: a sheet the parser rejects ships as authored with one warning.
      if (type === 'css' || type === 'css/module') {
        const guard = resolveDevelopDistFile('css-parse-guard-loader')
        const list = use as Array<Record<string, unknown>>
        if (!list.some((entry) => entry?.loader === guard)) {
          list.unshift({loader: guard})
        }
        list.unshift({
          loader: resolveDevelopDistFile('late-css-import-loader')
        })
      }

      // First in the list runs LAST, so the scan reads the final CSS a
      // preprocessor produced, not the .scss or .less it was authored in.
      // Its output is the runtime stylesheet module, hence the JS type: an
      // inlined data: URL could never name the extension root in a url().
      let ruleType = type
      if (type === 'asset/inline' && manifestPath) {
        ;(use as Array<Record<string, unknown>>).unshift({
          loader: resolveDevelopDistFile('dead-css-url-loader'),
          options: {manifestPath, projectPath}
        })
        ruleType = 'javascript/auto'
      }

      return {test, exclude, type: ruleType, issuer, use} as RuleSetRule
    })
  )
}
