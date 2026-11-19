//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {RuleSetRule} from '@rspack/core'
import {resolveDevelopDistFile} from '../lib/develop-context'
import type {DevOptions} from '../types'
import {isUsingLess} from './css-tools/less'
import {
  isUsingPostCss,
  maybeUsePostCss,
  type PostCssRuleReader
} from './css-tools/postcss'
import {isUsingSass} from './css-tools/sass'
import {isUsingTailwind} from './css-tools/tailwind'

export interface StyleLoaderOptions {
  mode: DevOptions['mode']
  loader?: string
  loaderOptions?: Record<string, unknown>
  postCss?: PostCssRuleReader
  // Hears a setup failure the build survives, to say it once per compiler.
  warn?: (message: string) => void
  // Runs on what the preprocessor wrote, ahead of PostCSS.
  afterPreprocessor?: {loader: string; options?: Record<string, unknown>}
}

// Whether any rule of this project asks PostCSS what to do with a sheet.
export function usesStyleTools(projectPath: string): boolean {
  return (
    isUsingPostCss(projectPath) ||
    isUsingTailwind(projectPath) ||
    isUsingSass(projectPath) ||
    isUsingLess(projectPath)
  )
}

export async function commonStyleLoaders(
  projectPath: string,
  opts: StyleLoaderOptions
): Promise<RuleSetRule['use']> {
  const styleLoaders: RuleSetRule['use'] = []

  if (usesStyleTools(projectPath)) {
    const readPostCss = opts.postCss ?? maybeUsePostCss
    const maybeInstallPostCss = await readPostCss(projectPath, opts)

    if (maybeInstallPostCss.loader) {
      // Pitches ahead of postcss-loader: a plain .css file that doesn't parse ships
      // verbatim with a warning; browsers error-recover invalid CSS, so must the build.
      styleLoaders.push({
        loader: resolveDevelopDistFile('css-parse-guard-loader')
      })
      // A copy per rule: every rule of one compiler shares the one read.
      ;(styleLoaders as Array<Record<string, unknown>>).push({
        ...maybeInstallPostCss
      })
    }
  }

  if (opts.afterPreprocessor) styleLoaders.push(opts.afterPreprocessor)

  if (opts.loader) {
    styleLoaders.push({
      loader: opts.loader,
      options: {
        ...opts.loaderOptions,
        sourceMap: opts.mode === 'development'
      }
    })
  }

  return styleLoaders.filter(Boolean)
}
