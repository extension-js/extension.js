//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {RuleSetRule} from '@rspack/core'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {
  ensureOptionalContractPackageResolved,
  formatInstallHint
} from '../../lib/optional-deps-resolver'
import {NOT_RAW_RESOURCE_QUERY} from '../../lib/resource-query'
import type {DevOptions} from '../../types'
import {commonStyleLoaders} from '../common-style-loaders'
import type {PostCssRuleReader} from '../css-tools/postcss'
import {createSassLoaderOptions} from '../css-tools/sass'

// The request the bundler makes for an @import in a sheet it parses.
export const CSS_IMPORT_DEPENDENCY = 'css-import'

export interface PreprocessorUsage {
  useSass?: boolean
  useLess?: boolean
  // The compiler's one reader of the PostCSS config, shared by every rule.
  postCss?: PostCssRuleReader
}

type PreprocessorLoader = 'sass-loader' | 'less-loader'

// Same absolute path the vue, svelte and postcss loaders already get. A
// hoisted install keeps the loader above the project, so Node resolves it.
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
  issuer?: RuleSetRule['issuer']
  issuerLayer?: RuleSetRule['issuerLayer']
  // The kind of request that reached the sheet, an @import among them.
  dependency?: RuleSetRule['dependency']
  // Set for inlined stylesheets, whose url() children never reach the module
  // graph. The sheet leaves the chain as a module that resolves them at runtime.
  manifestPath?: string
  // A Gecko MAIN world file opens on the read that takes the extension base,
  // and its inlined sheet resolves the extension root from that copy.
  gecko?: boolean
  // The attribute this extension's bridge writes the base under.
  baseAttribute?: string
  // The one scheme the build's engine serves an extension under.
  baseScheme?: string
}

export async function buildCssRules(
  projectPath: string,
  mode: DevOptions['mode'],
  usage: PreprocessorUsage,
  opts: BuildCssRulesOptions
): Promise<RuleSetRule[]> {
  const {useSass = true, useLess = true, postCss} = usage
  const {nonModuleType, issuer, issuerLayer, manifestPath, gecko} = opts
  const {dependency} = opts
  const {baseAttribute, baseScheme} = opts

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

  // Asked only when a warning prints, and once: naming the package manager
  // of a project can start a process.
  const hints = new Map<string, string>()

  const install = (tool: 'sass' | 'less'): string => {
    const hint = hints.get(tool) ?? formatInstallHint(projectPath, [tool])

    hints.set(tool, hint)

    return hint
  }

  return Promise.all(
    fileTypes.map(async ({test, exclude, type, loader, missingTool}) => {
      // An inlined sheet has no base for a relative @import, so the rules it
      // imports come in before PostCSS reads the sheet.
      const afterPreprocessor =
        type === 'asset/inline' && manifestPath
          ? {
              loader: resolveDevelopDistFile('dead-css-url-loader'),
              options: {manifestPath, projectPath, inlineImports: true}
            }
          : undefined
      const use = loader
        ? await commonStyleLoaders(projectPath, {
            mode: mode as 'development' | 'production',
            postCss,
            afterPreprocessor,
            loader: await resolvePreprocessorLoader(loader, projectPath),
            // commonStyleLoaders sets sourceMap from the mode for both.
            loaderOptions:
              loader === 'sass-loader'
                ? createSassLoaderOptions(projectPath)
                : {}
          })
        : await commonStyleLoaders(projectPath, {
            mode: mode as 'development' | 'production',
            postCss,
            afterPreprocessor
          })

      if (missingTool) {
        ;(use as Array<Record<string, unknown>>).push({
          loader: resolveDevelopDistFile('preprocessor-passthrough-loader'),
          options: {install}
        })
      }

      // Runs last, right before rspack's native CSS parser, which fails the
      // module on an @import after other rules that browsers simply skip.
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
      // preprocessor produced. Its output is a module, hence the JS type.
      let ruleType = type

      // A sheet that ships as a file names what public/ owns by the root path
      // the copier ships, however url() spelled it; rspack would emit a copy.
      if (manifestPath && type !== 'asset/inline') {
        ;(use as Array<Record<string, unknown>>).unshift({
          loader: resolveDevelopDistFile('public-css-url-loader'),
          options: {manifestPath, projectPath}
        })
      }

      if (type === 'asset/inline' && manifestPath) {
        ;(use as Array<Record<string, unknown>>).unshift({
          loader: resolveDevelopDistFile('dead-css-url-loader'),
          options: {
            manifestPath,
            projectPath,
            ...(gecko ? {gecko} : {}),
            baseAttribute,
            baseScheme
          }
        })

        ruleType = 'javascript/auto'
      }

      // A sheet is imported for its effect alone, and a package.json that
      // says sideEffects: false would otherwise drop it from the build.
      const emitsSheet = ruleType === 'css' || ruleType === 'css/module'

      return {
        test,
        exclude,
        type: ruleType,
        ...(emitsSheet ? {sideEffects: true} : {}),
        ...(issuer ? {issuer} : {}),
        ...(issuerLayer ? {issuerLayer} : {}),
        ...(dependency ? {dependency} : {}),
        resourceQuery: NOT_RAW_RESOURCE_QUERY,
        use
      } as RuleSetRule
    })
  )
}
