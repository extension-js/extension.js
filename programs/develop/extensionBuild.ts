// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import getProjectPath from './steps/getProjectPath'
import buildWebpack from './webpack/buildWebpack'

export interface BuildOptions {
  browser?: 'chrome' | 'edge'
  noPolyfill?: boolean
}

export default function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  {...buildOptions}: BuildOptions
) {
  const projectPath = getProjectPath(pathOrRemoteUrl)

  try {
    buildWebpack(projectPath, {...buildOptions})
  } catch (error: any) {
    console.log(`
      🚨 \`Error while building the extension:\`\n${error}
    `)
    process.exit(1)
  }
}
