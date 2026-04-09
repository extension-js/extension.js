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
import {ensureDependencies} from './webpack/webpack-lib/ensure-dependencies'
import {getProjectStructure} from './webpack/webpack-lib/project'
import {preflightOptionalDependencies} from './webpack/webpack-lib/preflight-optional-deps'
import {
  type FileConfig,
  type BuildOptions,
  type DevOptions,
  type PreviewOptions,
  type Manifest
} from './webpack/webpack-types'
import {
  BuildEmitter,
  type CompiledEvent,
  type BuildErrorEvent,
  type ReloadType,
  type ReloadInstruction,
  type BrowserLauncherFn,
  type BrowserLaunchOptions,
  type BrowserController
} from './webpack/plugin-browsers'

export async function preflightOptionalDependenciesForProject(
  pathOrRemoteUrl: string,
  mode: DevOptions['mode'] = 'development'
): Promise<void> {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  await preflightOptionalDependencies(projectStructure, mode, {
    exitOnInstall: false,
    showRunAgainMessage: false
  })
}

export {
  extensionBuild,
  BuildOptions,
  extensionDev,
  DevOptions,
  // extensionPreview is available via the lightweight 'extension-develop/preview'
  // entry point. It is re-exported here for backward compatibility but new
  // consumers should import from 'extension-develop/preview' to avoid pulling
  // in the full bundler toolchain.
  extensionPreview,
  PreviewOptions,
  FileConfig,
  Manifest,
  ensureDependencies,
  BuildEmitter,
  CompiledEvent,
  BuildErrorEvent,
  ReloadType,
  ReloadInstruction,
  BrowserLauncherFn,
  BrowserLaunchOptions,
  BrowserController
}
