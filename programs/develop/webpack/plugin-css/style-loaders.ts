import {type RuleSetRule} from 'webpack'
import {commonStyleLoaders} from './common-style-loaders'

export function styleLoaders(projectDir: string, opts: any): RuleSetRule[] {
  const loaders: RuleSetRule[] = [
    {
      test: /\.css$/,
      exclude: /\.module\.css$/,
      type: 'javascript/auto',
      // https://stackoverflow.com/a/60482491/4902448
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          use: commonStyleLoaders(projectDir, {
            regex: /\.css$/,
            mode: opts.mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: commonStyleLoaders(projectDir, {
            regex: /\.css$/,
            mode: opts.mode,
            useMiniCssExtractPlugin: opts.mode === 'production'
          })
        }
      ]
    },
    {
      test: /\.module\.css$/,
      type: 'javascript/auto',
      // https://stackoverflow.com/a/60482491/4902448
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          use: commonStyleLoaders(projectDir, {
            regex: /\.module\.css$/,
            mode: opts.mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: commonStyleLoaders(projectDir, {
            regex: /\.module\.css$/,
            mode: opts.mode,
            useMiniCssExtractPlugin: opts.mode === 'production'
          })
        }
      ]
    }
  ]

  // if (isUsingLess) {
  //   loaders.push(...maybeUseLess(projectDir, opts));
  // }

  // if (isUsingSass) {
  //   loaders.push(...maybeUseSass(projectDir, opts));
  // }

  return loaders
}
