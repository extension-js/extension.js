// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import type webpack from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'

import {isUsingTailwind} from '../options/tailwind'

export default function getCommonStyleLoaders(
  projectDir: string,
  opts: any
): any {
  const styleLoaders: webpack.RuleSetUse = [
    // While the current experimental CSS feature from webpack
    // is able to replace the MiniCssExtractPlugin, it cannot
    // handle content_scripts.css, so we still use MiniCssExtractPlugin
    // for that.
    // MiniCssExtractPlugin.loader,
    require.resolve('style-loader'),
    // Translates CSS into CommonJS
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
