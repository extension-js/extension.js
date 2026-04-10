// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {extensionBuild} from './command-build'
import {extensionDev} from './command-dev'
import {extensionPreview} from './command-preview'
import {
  type FileConfig,
  type BuildOptions,
  type DevOptions,
  type PreviewOptions,
  type Manifest
} from './types'
import {
  BuildEmitter,
  type CompiledEvent,
  type BuildErrorEvent,
  type ReloadType,
  type ReloadInstruction,
  type BrowserLauncherFn,
  type BrowserLaunchOptions,
  type BrowserController
} from './plugin-browsers'

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
  BuildEmitter,
  CompiledEvent,
  BuildErrorEvent,
  ReloadType,
  ReloadInstruction,
  BrowserLauncherFn,
  BrowserLaunchOptions,
  BrowserController
}
