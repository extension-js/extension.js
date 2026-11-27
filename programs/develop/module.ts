// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {extensionBuild as BuildCommand} from './command-build'
import type {extensionDev as DevCommand} from './command-dev'
import type {extensionPreview as PreviewCommand} from './command-preview'
import type {endSessionAsFailed as EndSessionAsFailed} from './dev-server/session-end'
import type {BuildSummary, SafariPackageSummary} from './lib/build-summary'
import type {CompanionExtensionsConfig} from './lib/companion-extensions/types'
import type {
  CommandLayerConfig,
  ProjectConfigDefaults,
  PublicConfigEnvTarget
} from './lib/config-loader'
import type {ErrorCode} from './lib/messaging'
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

const [build, dev, preview, browsers, config, sessionEnd, artifacts] =
  await Promise.all([
    import('./command-build'),
    import('./command-dev'),
    import('./command-preview'),
    import('./plugin-browsers'),
    import('./lib/config-loader'),
    import('./dev-server/session-end'),
    import('./lib/ensure-develop-artifacts')
  ])

export const extensionBuild: typeof BuildCommand = build.extensionBuild
export const extensionDev: typeof DevCommand = dev.extensionDev
// extensionPreview is re-exported for backward compatibility. The same
// function is the only export of 'extension-develop/preview'.
export const extensionPreview: typeof PreviewCommand = preview.extensionPreview
export const BuildEmitter = browsers.BuildEmitter
export type BuildEmitter = BuildEmitterInstance
// A host may leave the run unnamed: the mode then follows the command, and
// a load with no command is a build. Inside this package every load names it.
export const loadCommandConfig = (
  projectPath: string,
  command: 'dev' | 'build' | 'start' | 'preview',
  envTarget?: PublicConfigEnvTarget
): Promise<CommandLayerConfig> =>
  config.loadCommandConfig(
    projectPath,
    command,
    config.envTargetOf(command, envTarget)
  )
// Installs a project's declared packages when none are in place, and answers
// whether it did. A config that failed to load is worth one more read then.
export const installMissingProjectDependencies: (
  projectPath: string
) => Promise<boolean> = artifacts.installMissingProjectDependencies
export const loadProjectConfigDefaults = (
  projectPath: string,
  envTarget?: PublicConfigEnvTarget
): Promise<ProjectConfigDefaults> =>
  config.loadProjectConfigDefaults(
    projectPath,
    config.envTargetOf(undefined, envTarget)
  )
// Ends one dev session of this process as a failure the host names.
export const endSessionAsFailed: typeof EndSessionAsFailed =
  sessionEnd.endSessionAsFailed

export type {
  // The codes a host's hintFor resolver is called with.
  ErrorCode,
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
  // What loadCommandConfig and loadProjectConfigDefaults resolve to.
  CommandLayerConfig,
  ProjectConfigDefaults,
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
