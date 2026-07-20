// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {PluginInterface} from '../browsers-types'

export type SafariPluginLike = Pick<
  PluginInterface,
  'extension' | 'noOpen' | 'instanceId' | 'dryRun'
> & {
  browser: PluginInterface['browser']
  safariBinary?: string
  appName?: string
  bundleId?: string
  macOsOnly?: boolean
  forceRegenerate?: boolean
}

export interface SafariBuildConfig {
  extensionDir: string
  projectLocation: string
  appName: string
  bundleIdentifier: string
  /** True when the bundle id was derived (dev.extensionjs.*), not user-set. */
  bundleIdDerived: boolean
  macOsOnly: boolean
  language: 'swift' | 'objc'
  open: boolean
  safariBinary?: string
}
