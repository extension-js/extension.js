// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import type webpack from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'

import {isUsingTailwind} from '../options/tailwind'

export default function getCommonStyleLoaders(
  projectDir: string,
  opts: any
): any {
  const styleLoaders: webpack.RuleSetUse = [
    // This plugin extracts CSS into separate files.
    // It creates a CSS file per JS file which contains CSS.
    // It supports On-Demand-Loading of CSS and SourceMaps
    // See https://webpack.js.org/plugins/mini-css-extract-plugin/
    {
      loader: MiniCssExtractPlugin.loader
    },
    {
      // `css-loader` resolves paths in CSS and adds assets as dependencies.
      loader: require.resolve('css-loader')
    },
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
          ]
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
