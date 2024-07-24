import {type RuleSetRule} from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import {isUsingTailwind, maybeUseTailwindPlugin} from './css-tools/tailwind'
import {isUsingSass} from './css-tools/sass'
import {isUsingLess} from './css-tools/less'

export function commonStyleLoaders(
  projectPath: string,
  opts: any
): RuleSetRule['use'] {
  const styleLoaders: RuleSetRule['use'] = [
    opts.useMiniCssExtractPlugin
      ? MiniCssExtractPlugin.loader
      : require.resolve('style-loader'),
    require.resolve('css-loader')
  ]

  if (
    isUsingTailwind(projectPath) ||
    isUsingSass(projectPath) ||
    isUsingLess(projectPath)
  ) {
    styleLoaders.push({
      // `postcss-loader` applies autoprefixer to our CSS.
      loader: require.resolve('postcss-loader'),
      options: {
        postcssOptions: {
          parser: require.resolve('postcss-scss'),
          ident: 'postcss',
          config: false,
          plugins: [
            ...maybeUseTailwindPlugin(projectPath, opts),
            require.resolve('postcss-flexbugs-fixes'),
            [
              require.resolve('postcss-preset-env'),
              {
                autoprefixer: {
                  flexbox: 'no-2009'
                },
                stage: 3
              }
            ],
            require.resolve('postcss-normalize')
          ]
        },
        sourceMap: opts.mode === 'development'
      }
    })
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
