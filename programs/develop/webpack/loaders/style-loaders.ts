// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import type webpack from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'

import {isUsingTailwind} from '../options/tailwind'

function getCommonStyleLoaders(projectDir: string, opts: any): any {
  const styleLoaders: webpack.RuleSetUse = [
    opts.useMiniCssExtractPlugin
      ? MiniCssExtractPlugin.loader
      : require.resolve('style-loader'),
    require.resolve('css-loader'),
    {
      // `postcss-loader` applies autoprefixer to our CSS.
      loader: require.resolve('postcss-loader'),
      options: {
        postcssOptions: {
          parser: require.resolve('postcss-scss'),
          ident: 'postcss',
          config: false,
          plugins: [
            ...(isUsingTailwind(projectDir)
              ? [require.resolve('tailwindcss', {paths: [projectDir]})]
              : []),
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
          ].filter(Boolean)
        },
        sourceMap: false
      }
    }
  ]

  if (opts.loader) {
    styleLoaders.push({
      loader: opts.loader,
      options: {
        sourceMap: opts.mode === 'development'
      }
    })
  }

  return styleLoaders
}

export default function styleLoaders(projectDir: string, opts: any) {
  return [
    {
      test: /\.css$/,
      exclude: /\.module\.css$/,
      type: 'javascript/auto',
      // https://stackoverflow.com/a/60482491/4902448
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          use: getCommonStyleLoaders(projectDir, {
            regex: /\.css$/,
            mode: opts.mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: getCommonStyleLoaders(projectDir, {
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
      use: getCommonStyleLoaders(projectDir, {
        regex: /\.module\.css$/,
        mode: opts.mode,
        useMiniCssExtractPlugin: true
      })
    },
    {
      test: /\.(scss|sass)$/,
      exclude: /\.module\.css$/,
      // https://stackoverflow.com/a/60482491/4902448
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          use: getCommonStyleLoaders(projectDir, {
            regex: /\.(scss|sass)$/,
            loader: require.resolve('sass-loader'),
            mode: opts.mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: getCommonStyleLoaders(projectDir, {
            regex: /\.(scss|sass)$/,
            loader: require.resolve('sass-loader'),
            mode: opts.mode,
            useMiniCssExtractPlugin: true
          })
        }
      ]
    },
    {
      test: /\.module\.(scss|sass)$/,
      // https://stackoverflow.com/a/60482491/4902448
      use: getCommonStyleLoaders(projectDir, {
        regex: /\.module\.(scss|sass)$/,
        loader: require.resolve('sass-loader'),
        mode: opts.mode,
        useMiniCssExtractPlugin: true
      })
    },
    {
      test: /\.less$/,
      exclude: /\.module\.css$/,
      // https://stackoverflow.com/a/60482491/4902448
      oneOf: [
        {
          resourceQuery: /is_content_css_import=true/,
          use: getCommonStyleLoaders(projectDir, {
            regex: /\.less$/,
            loader: require.resolve('less-loader'),
            mode: opts.mode,
            useMiniCssExtractPlugin: false
          })
        },
        {
          use: getCommonStyleLoaders(projectDir, {
            regex: /\.less$/,
            loader: require.resolve('less-loader'),
            mode: opts.mode,
            useMiniCssExtractPlugin: true
          })
        }
      ]
    }
  ]
}
