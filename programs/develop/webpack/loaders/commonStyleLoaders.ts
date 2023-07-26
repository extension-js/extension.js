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
    opts.mode === 'development'
      ? // For production builds it's recommended to extract the CSS from
        // your bundle being able to use parallel loading of CSS/JS
        // resources later on. This can be achieved by using the
        // mini-css-extract-plugin, because it creates separate css files.
        // For development mode (including webpack-dev-server) you can use
        // style-loader, because it injects CSS into the DOM using multiple and works faster.
        require.resolve('style-loader')
      : // This plugin extracts CSS into separate files.
        // It creates a CSS file per JS file which contains CSS.
        // It supports On-Demand-Loading of CSS and SourceMaps
        // See https://webpack.js.org/plugins/mini-css-extract-plugin/
        {
          loader: MiniCssExtractPlugin.loader
          // options: {
          //   // only enable hot in development
          //   hmr: opts.mode === 'development',
          //   // if hmr does not work, this is a forceful method.
          //   publicPath: '',
          //   reloadAll: true
          // }
        },
    {
      // `css-loader` resolves paths in CSS and adds assets as dependencies.
      loader: require.resolve('css-loader'),
      options: {
        importLoaders: 1,
        modules: true
      }
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
