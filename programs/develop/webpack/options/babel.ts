// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'

import presetModernExtensions from 'babel-preset-modern-browser-extension'

const projectWideBabelConfigFiles = ['babel.config.json', 'babel.config.js']

export function getBabelConfigFile(projectDir: string) {
  for (const file of projectWideBabelConfigFiles) {
    const configFile = path.join(projectDir, file)

    if (fs.existsSync(configFile)) {
      console.log(
        `🟡 - Using Babel config file: \`${path.basename(configFile)}\``
      )
      return configFile
    }
  }

  return undefined
}

export function babelConfig(projectDir: string, opts: any) {
  return {
    babelrc: false,
    configFile: getBabelConfigFile(projectDir),
    compact: opts.mode === 'production',
    overrides: [presetModernExtensions(opts).overrides],
    presets: [...presetModernExtensions(opts).presets],
    plugins: [
      ...presetModernExtensions(opts).plugins,
      opts.mode === 'development' && require.resolve('react-refresh/babel')
    ].filter(Boolean)
  }
}
