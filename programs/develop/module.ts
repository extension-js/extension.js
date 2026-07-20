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
import {
  type BrowserController,
  type BrowserLauncherFn,
  type BrowserLaunchOptions,
  BuildEmitter,
  type BuildErrorEvent,
  type CompiledEvent
} from './plugin-browsers'
import type {ReloadInstruction, ReloadType} from './plugin-reload'
import type {
  BuildOptions,
  DevOptions,
  FileConfig,
  Manifest,
  PreviewOptions
} from './types'

export {
  extensionBuild,
  type BuildOptions,
  extensionDev,
  type DevOptions,
  // extensionPreview is re-exported for backward compatibility; new consumers
  // should import 'extension-develop/preview' to skip the bundler toolchain.
  extensionPreview,
  type PreviewOptions,
  type FileConfig,
  type Manifest,
  BuildEmitter,
  type CompiledEvent,
  type BuildErrorEvent,
  type ReloadType,
  type ReloadInstruction,
  type BrowserLauncherFn,
  type BrowserLaunchOptions,
  type BrowserController
}
