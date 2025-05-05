import {type RuleSetRule} from '@rspack/core'
import {type DevOptions} from '../../commands/commands-lib/config-types'
import {isUsingTailwind} from './css-tools/tailwind'
import {isUsingSass} from './css-tools/sass'
import {isUsingLess} from './css-tools/less'
import {maybeUsePostCss} from './css-tools/postcss'

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
    isUsingTailwind(projectPath) ||
    isUsingSass(projectPath) ||
    isUsingLess(projectPath)
  ) {
    const maybeInstallPostCss = await maybeUsePostCss(projectPath, opts)
    if (maybeInstallPostCss.loader) {
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
