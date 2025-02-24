import webpack from 'webpack'
import * as rspack from '@rspack/core'
import { join } from 'path'
import { fileURLToPath } from 'url'
import WebExtensionPlugin from '../index.js'
import CopyPlugin from 'copy-webpack-plugin'

const __dirname = join(fileURLToPath(import.meta.url), '..')
interface Run {
  input: string
  output: string
  touch?: (
    webpackConfig: import('webpack').Configuration,
    rspackConfig: import('@rspack/core').Configuration,
    _rspack: typeof rspack
  ) => void
  option: import('../index.js').WebExtensionPluginOptions
  touchManifest?: (manifest: any) => void
}

export function run({ input, output, option, touch, touchManifest }: Run) {
  const isMV3 = output.includes('mv3')
  const manifest = join(__dirname, isMV3 ? './fixtures/manifest-mv3.json' : './fixtures/manifest-mv2.json')
  const copyPluginOptions = {
    patterns: [
      {
        from: manifest,
        to: 'manifest.json',
        transform: touchManifest
          ? (content: string | Buffer) => {
              if (typeof content !== 'string') content = content.toString('utf8')
              const json = JSON.parse(content)
              touchManifest(json)
              return JSON.stringify(json, undefined, 4)
            }
          : undefined,
      },
    ],
  }
  const config: import('webpack').Configuration = {
    mode: 'development',
    context: join(__dirname, input),
    devtool: false,
    entry: { background: './background.js', content: './content.js' },
    output: {
      path: join(__dirname, output),
      clean: true,
      chunkFilename: 'chunks-[chunkhash].js',
      environment: { arrowFunction: true, const: true, optionalChaining: true, globalThis: true },
    },
    plugins: [new WebExtensionPlugin(option), new CopyPlugin(copyPluginOptions)],
  }

  const rspackConfig: import('@rspack/core').Configuration = {
    mode: 'development',
    context: join(__dirname, input),
    devtool: false,
    entry: { background: './background.js', content: './content.js' },
    // module: { parser: { javascript: { dynamicImportMode: 'eager' } } },
    output: {
      clean: true,
      chunkFilename: 'chunks-[chunkhash].js',
      environment: { arrowFunction: true, const: true, optionalChaining: true, globalThis: true },

      path: join(__dirname, output + '-rspack'),
      hotUpdateChunkFilename: 'hot/[id].js',
      hotUpdateMainFilename: 'hot/[runtime].json',
    },
    plugins: [new WebExtensionPlugin(option), new rspack.CopyRspackPlugin(copyPluginOptions)],
  }
  touch?.(config, rspackConfig, rspack)

  return Promise.allSettled([
    //
    compile(webpack(config)),
    compile(rspack.rspack(rspackConfig)),
  ])
}

function compile(compiler: webpack.Compiler | rspack.Compiler) {
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error) return reject(error)
      if (stats?.hasErrors()) return reject(stats.compilation.errors)
      if (!stats) return reject(new TypeError('stats from compiler is null'))
      return resolve(stats.compilation.warnings)
    })
  })
}
