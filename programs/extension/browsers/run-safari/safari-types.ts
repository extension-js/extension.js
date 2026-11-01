// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {PluginInterface} from '../browsers-types'
import type {SafariPipelineTools} from './safari-launch/tools'
import type {SafariUiTools} from './safari-ui/tools'

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
  // Absolute path of a square PNG the app icon set is made from, unchanged.
  appIcon?: string
  forceRegenerate?: boolean
  // Opened in the automation window once the dev session holds one.
  startingUrl?: string
  // Dev sessions announce the identity card and ready line after the first
  // full package; build/preview packaging stays quiet.
  announceDevReady?: boolean
  // The processes the pipeline drives. Unset means the real xcrun,
  // xcodebuild, open, osascript and pluginkit.
  tools?: SafariPipelineTools
  enableExtension?: boolean
  uiTools?: SafariUiTools
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
  appIcon?: string
}
