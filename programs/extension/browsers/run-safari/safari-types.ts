// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {PluginInterface} from '../browsers-types'
import type {SafariPipelineTools} from './safari-launch/tools'

export type SafariPluginLike = Pick<
  PluginInterface,
  'extension' | 'noOpen' | 'instanceId' | 'dryRun'
> & {
  browser: PluginInterface['browser']
  safariBinary?: string
  developmentTeam?: string
  appName?: string
  bundleId?: string
  macOsOnly?: boolean
  forceRegenerate?: boolean
  // Dev sessions announce the identity card and ready line after the first
  // full package; build/preview packaging stays quiet.
  announceDevReady?: boolean
  // The processes the pipeline drives. Unset means the real xcrun,
  // xcodebuild, open, osascript and pluginkit.
  tools?: SafariPipelineTools
}

export interface SafariBuildConfig {
  extensionDir: string
  projectLocation: string
  appName: string
  bundleIdentifier: string
  bundleIdDerived: boolean
  macOsOnly: boolean
  language: 'swift' | 'objc'
  open: boolean
  safariBinary?: string
  developmentTeam?: string
}
