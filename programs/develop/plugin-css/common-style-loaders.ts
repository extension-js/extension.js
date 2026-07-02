//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {type RuleSetRule} from '@rspack/core'
import {isUsingTailwind} from './css-tools/tailwind'
import {isUsingSass} from './css-tools/sass'
import {isUsingLess} from './css-tools/less'
import {isUsingPostCss, maybeUsePostCss} from './css-tools/postcss'
import {resolveDevelopDistFile} from '../lib/develop-context'
import {type DevOptions} from '../types'

export interface StyleLoaderOptions {
  mode: DevOptions['mode']
  loader?: string
  loaderOptions?: Record<string, any>
}

export async function commonStyleLoaders(
  projectPath: string,
  opts: StyleLoaderOptions
): Promise<RuleSetRule['use']> {
  const styleLoaders: RuleSetRule['use'] = []

  // Handle PostCSS for Tailwind, Sass, or Less
  if (
    isUsingPostCss(projectPath) ||
    isUsingTailwind(projectPath) ||
    isUsingSass(projectPath) ||
    isUsingLess(projectPath)
  ) {
    const maybeInstallPostCss = await maybeUsePostCss(projectPath, opts)
    if (maybeInstallPostCss.loader) {
      // Pitches ahead of postcss-loader: a plain .css file that doesn't parse
      // ships verbatim with a warning instead of failing the build (G17) —
      // browsers error-recover invalid CSS, so the build must too.
      styleLoaders.push({loader: resolveDevelopDistFile('css-parse-guard-loader')})
      styleLoaders.push(maybeInstallPostCss as any)
    }
  }

  // Handle Sass/Less loaders
  if (opts.loader) {
    styleLoaders.push({
      // Use either external loader or builtin
      loader: opts.loader,
      options: {
        ...opts.loaderOptions,
        sourceMap: opts.mode === 'development'
      }
    })
  }

  return styleLoaders.filter(Boolean)
}
