// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {bold, blue, yellow} from '@colors/colors/safe'
import presetModernExtensions from 'babel-preset-modern-browser-extension'

const projectWideBabelConfigFiles = ['babel.config.json', 'babel.config.js']

export function getBabelConfigFile(projectDir: string) {
  const manifest = require(path.join(projectDir, 'manifest.json'))
  for (const file of projectWideBabelConfigFiles) {
    const configFile = path.join(projectDir, file)

    if (fs.existsSync(configFile)) {
      console.log(
        bold(
          `🧩 Extension.js ${blue('►►►')} ${manifest.name} (v${
            manifest.version
          }) `
        ) + `is using ${bold(yellow('Babel'))} config file.`
      )
      return configFile
    }
  }

  return undefined
}

export function babelConfig(projectDir: string, opts: any) {
  return {
    // When set, the given directory will be used to cache the results
    // of the loader. Future webpack builds will attempt to read from
    // the cache to avoid needing to run the potentially expensive Babel
    // recompilation process on each run. If the value is set to true in
    // options ({cacheDirectory: true}), the loader will use the default
    // cache directory in node_modules/.cache/babel-loader or fallback to
    // the default OS temporary file directory if no node_modules folder
    // could be found in any root directory.
    cacheDirectory: false,
    // When set, each Babel transform output will be compressed with Gzip.
    // If you want to opt-out of cache compression, set it to false -- your
    // project may benefit from this if it transpiles thousands of files.
    cacheCompression: false,
    babelrc: false,
    configFile: getBabelConfigFile(projectDir),
    compact: opts.mode === 'production',
    overrides: [presetModernExtensions(opts).overrides],
    presets: [...presetModernExtensions(opts).presets],
    plugins: [
      ...presetModernExtensions(opts).plugins,
      process.env.NODE_ENV !== 'test' &&
        opts.mode === 'development' &&
        require.resolve('react-refresh/babel')
    ].filter(Boolean)
  }
}
