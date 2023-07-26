// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import webpack from 'webpack'

import compilerConfig from './webpack-config'
import {type DevOptions} from '../extensionDev'

export default function startWebpack(
  projectDir: string,
  {browser}: DevOptions
) {
  const webpackConfig = compilerConfig(projectDir, 'production', {
    browser
  })

  webpack(webpackConfig).run((err) => {
    if (err != null) {
      console.log(err)
      process.exit(1)
    }

    process.exit(0)
  })
}
