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
import {isUsingPostCss, maybeUsePostCss} from './css-tools/postcss'
import {isUsingSass} from './css-tools/sass'
import {isUsingTailwind} from './css-tools/tailwind'

export interface StyleLoaderOptions {
  mode: DevOptions['mode']
  loader?: string
  loaderOptions?: Record<string, unknown>
}

export async function commonStyleLoaders(
  projectPath: string,
  opts: StyleLoaderOptions
): Promise<RuleSetRule['use']> {
  const styleLoaders: RuleSetRule['use'] = []

  if (
    isUsingPostCss(projectPath) ||
    isUsingTailwind(projectPath) ||
    isUsingSass(projectPath) ||
    isUsingLess(projectPath)
  ) {
    const maybeInstallPostCss = await maybeUsePostCss(projectPath, opts)
    if (maybeInstallPostCss.loader) {
      // Pitches ahead of postcss-loader: a plain .css file that doesn't parse ships
      // verbatim with a warning; browsers error-recover invalid CSS, so must the build.
      styleLoaders.push({
        loader: resolveDevelopDistFile('css-parse-guard-loader')
      })
      ;(styleLoaders as Array<Record<string, unknown>>).push(
        maybeInstallPostCss as Record<string, unknown>
      )
    }
  }

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
