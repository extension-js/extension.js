// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {extensionBuild} from './webpack/command-build'
import {extensionDev} from './webpack/command-dev'
import {extensionPreview} from './webpack/command-preview'
import {extensionStart} from './webpack/command-start'
import {ensureDependencies} from './webpack/webpack-lib/ensure-dependencies'
import {getProjectStructure} from './webpack/webpack-lib/project'
import {preflightOptionalDependencies} from './webpack/webpack-lib/preflight-optional-deps'
import {
  type FileConfig,
  type BuildOptions,
  type DevOptions,
  type PreviewOptions,
  type StartOptions,
  type Manifest
} from './webpack/webpack-types'

export async function preflightOptionalDependenciesForProject(
  pathOrRemoteUrl: string,
  mode: DevOptions['mode'] = 'development'
): Promise<void> {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  await preflightOptionalDependencies(projectStructure, mode)
}

export {
  extensionBuild,
  BuildOptions,
  extensionDev,
  DevOptions,
  extensionStart,
  StartOptions,
  extensionPreview,
  PreviewOptions,
  FileConfig,
  Manifest,
  ensureDependencies
}
