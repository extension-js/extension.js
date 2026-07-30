// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Must stay the first import: it has to run before anything transitively
// loads @rspack/core (see lib/rust-min-stack.ts).
import './lib/rust-min-stack'
import {extensionBuild} from './command-build'
import {extensionDev} from './command-dev'
import {extensionPreview} from './command-preview'
import type {BuildSummary, SafariPackageSummary} from './lib/build-summary'
import {
  type BrowserController,
  type BrowserLauncherFn,
  type BrowserLaunchOptions,
  BuildEmitter,
  type BuildErrorEvent,
  type CompiledEvent
} from './plugin-browsers'
import type {ReloadInstruction, ReloadType} from './plugin-reload'
import type {CompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/types'
import type {
  BrowserConfig,
  BrowserType,
  BuildOptions,
  DevOptions,
  FileConfig,
  Manifest,
  PreviewOptions,
  SafariPackagerFn,
  SafariPackagerOverrides,
  StartOptions
} from './types'

export {loadCommandConfig} from './lib/config-loader'
export {
  extensionBuild,
  type BuildOptions,
  extensionDev,
  type DevOptions,
  // extensionPreview is re-exported for backward compatibility; new consumers
  // should import 'extension-develop/preview' to skip the bundler toolchain.
  extensionPreview,
  type PreviewOptions,
  type StartOptions,
  type FileConfig,
  type BrowserConfig,
  type BrowserType,
  type CompanionExtensionsConfig,
  type Manifest,
  // extensionBuild resolves to a BuildSummary; naming it required reaching
  // into the package's internals before this export existed.
  type BuildSummary,
  type SafariPackageSummary,
  type SafariPackagerFn,
  type SafariPackagerOverrides,
  BuildEmitter,
  type CompiledEvent,
  type BuildErrorEvent,
  type ReloadType,
  type ReloadInstruction,
  type BrowserLauncherFn,
  type BrowserLaunchOptions,
  type BrowserController
}
