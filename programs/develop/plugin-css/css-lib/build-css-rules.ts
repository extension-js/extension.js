//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {RuleSetRule} from '@rspack/core'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {ensureOptionalContractPackageResolved} from '../../lib/optional-deps-resolver'
import {NOT_RAW_RESOURCE_QUERY} from '../../lib/resource-query'
import type {DevOptions} from '../../types'
import {commonStyleLoaders} from '../common-style-loaders'
import {createSassLoaderOptions} from '../css-tools/sass'

export interface PreprocessorUsage {
  useSass?: boolean
  useLess?: boolean
}

type PreprocessorLoader = 'sass-loader' | 'less-loader'

// Same absolute path the vue, svelte and postcss loaders already get. A bare
// name only resolves beside the project or beside extension-develop, and a
// hoisted install keeps the loader above both, so Node resolves it instead.
async function resolvePreprocessorLoader(
  loader: PreprocessorLoader,
  projectPath: string
): Promise<string> {
  try {
    const resolved = await ensureOptionalContractPackageResolved({
      contractId: loader === 'sass-loader' ? 'sass' : 'less',
      projectPath,
      dependencyId: loader
    })

    if (resolved !== projectPath) return resolved
  } catch {
    // Fall through to the bare name and rspack's own loader lookup.
  }

  return loader
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
    loader: PreprocessorLoader | null
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
            loader: await resolvePreprocessorLoader(loader, projectPath),
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
      let parser: RuleSetRule['parser']

      // A page sheet names a file public/ owns by the root path the copier
      // ships, however url() spelled it; rspack would emit a second copy.
      if (nonModuleType === 'css' && manifestPath && type !== 'asset/inline') {
        ;(use as Array<Record<string, unknown>>).unshift({
          loader: resolveDevelopDistFile('public-css-url-loader'),
          options: {manifestPath, projectPath}
        })
      }

      if (type === 'asset/inline' && manifestPath) {
        ;(use as Array<Record<string, unknown>>).unshift({
          loader: resolveDevelopDistFile('dead-css-url-loader'),
          options: {manifestPath, projectPath, sheet: 'inline'}
        })

        ruleType = 'javascript/auto'
      }

      // A content-script CSS module keeps rspack's scoping and class-name
      // exports, but its text lands in a <style> on the visited page too, so
      // the same rewrite runs and rspack leaves url() alone: resolved through
      // the module graph it would bake the '/' public path in again.
      if (
        type === 'css/module' &&
        nonModuleType === 'asset/inline' &&
        manifestPath
      ) {
        ;(use as Array<Record<string, unknown>>).unshift({
          loader: resolveDevelopDistFile('dead-css-url-loader'),
          options: {manifestPath, projectPath, sheet: 'chunk'}
        })

        parser = {url: false}
      }

      return {
        test,
        exclude,
        type: ruleType,
        issuer,
        resourceQuery: NOT_RAW_RESOURCE_QUERY,
        use,
        ...(parser ? {parser} : {})
      } as RuleSetRule
    })
  )
}
