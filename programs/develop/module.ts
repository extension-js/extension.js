// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {BuildSummary, SafariPackageSummary} from './lib/build-summary'
import {ensureRustMinStack} from './lib/rust-min-stack'
import type {
  BrowserController,
  BrowserLauncherFn,
  BrowserLaunchOptions,
  BuildEmitter as BuildEmitterInstance,
  BuildErrorEvent,
  CompiledEvent
} from './plugin-browsers'
import type {ReloadInstruction, ReloadType} from './plugin-reload'
import type {CompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/types'
// The option types a caller names are the public ones. The fields only the
// CLI and the engine set stay on the types the command files read.
import type {
  BrowserConfig,
  BrowserType,
  PublicBuildOptions as BuildOptions,
  PublicDevOptions as DevOptions,
  FileConfig,
  Manifest,
  PublicPreviewOptions as PreviewOptions,
  SafariPackagerFn,
  SafariPackagerOverrides,
  PublicStartOptions as StartOptions
} from './types'

// The rspack binding sizes its threads when it loads and never reads the
// variable again, so every module that reaches rspack loads after this call.
ensureRustMinStack()

const [build, dev, preview, browsers, config] = await Promise.all([
  import('./command-build'),
  import('./command-dev'),
  import('./command-preview'),
  import('./plugin-browsers'),
  import('./lib/config-loader')
])

export const extensionBuild = build.extensionBuild
export const extensionDev = dev.extensionDev
// extensionPreview is re-exported for backward compatibility. The same
// function is the only export of 'extension-develop/preview'.
export const extensionPreview = preview.extensionPreview
export const BuildEmitter = browsers.BuildEmitter
export type BuildEmitter = BuildEmitterInstance
export const loadCommandConfig = config.loadCommandConfig
export const loadProjectConfigDefaults = config.loadProjectConfigDefaults

export type {
  BuildOptions,
  DevOptions,
  PreviewOptions,
  StartOptions,
  FileConfig,
  BrowserConfig,
  BrowserType,
  CompanionExtensionsConfig,
  Manifest,
  // extensionBuild resolves to a BuildSummary. Naming it required reaching
  // into the package's internals before this export existed.
  BuildSummary,
  SafariPackageSummary,
  SafariPackagerFn,
  SafariPackagerOverrides,
  CompiledEvent,
  BuildErrorEvent,
  ReloadType,
  ReloadInstruction,
  BrowserLauncherFn,
  BrowserLaunchOptions,
  BrowserController
}
