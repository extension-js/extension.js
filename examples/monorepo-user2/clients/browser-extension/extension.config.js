const path = require('node:path')

/** @type {import('extension').FileConfig} */
module.exports = {
  commands: {
    dev: {
      browser: 'chrome',
      polyfill: true
    },
    build: {
      zipFilename: 'my-browser-extension.zip',
      zip: true,
      zipSource: true
    }
  },
  config: (config) => {
    // we want to be able to import from other packages of the monorepo
    config.module.rules.push({
      test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      include: [path.resolve(__dirname, '..', '..', 'packages')],
      exclude: /node_modules/,
      use: {
        loader: require.resolve('swc-loader'),
        options: {
          sync: true,
          module: {
            type: 'es6'
          },
          minify: config.mode === 'production',
          isModule: true,
          jsc: {
            target: 'es2016',
            parser: {
              syntax: 'typescript',
              tsx: true,
              dynamicImport: true
            },
            transform: {
              react: {
                development: config.mode === 'development',
                refresh: config.mode === 'development',
                runtime: 'automatic',
                importSource: 'react'
              }
            }
          }
        }
      }
    })

    return config
  }
}
