import {type RuleSetRule} from 'webpack'
import {DevOptions} from '../../commands/commands-lib/config-types'
import {isUsingTailwind} from './css-tools/tailwind'
import {isUsingSass} from './css-tools/sass'
import {isUsingLess} from './css-tools/less'
import {maybeUsePostCss} from './css-tools/postcss'

export interface StyleLoaderOptions {
  mode: DevOptions['mode']
  useMiniCssExtractPlugin: boolean
  loader?: string
  useShadowDom: boolean
}

export async function commonStyleLoaders(
  projectPath: string,
  opts: StyleLoaderOptions
): Promise<RuleSetRule['use']> {
  const styleLoaders: RuleSetRule['use'] = []

  if (
    isUsingTailwind(projectPath) ||
    isUsingSass(projectPath) ||
    isUsingLess(projectPath)
  ) {
    const maybeInstallPostCss = await maybeUsePostCss(projectPath, opts)
    if (maybeInstallPostCss.loader) {
      styleLoaders.push(maybeInstallPostCss)
    }
  }

  if (opts.loader) {
    styleLoaders.push(
      ...[
        {
          loader: require.resolve('resolve-url-loader'),
          options: {
            sourceMap: opts.mode === 'development',
            root: projectPath
          }
        },
        {
          loader: require.resolve(opts.loader),
          options: {
            sourceMap: opts.mode === 'development'
          }
        }
      ]
    )
  }

  return styleLoaders.filter(Boolean)
}
