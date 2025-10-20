import {DevOptions} from '../../../types/options'
import {PluginInterface} from '../browsers-types'

export type NormalizedBrowser = DevOptions['browser']

export interface NormalizedOptions extends Omit<PluginInterface, 'browser'> {
  browser: NormalizedBrowser
  profile?: string | false
  startingUrl?: string
  source?: string
  dryRun?: boolean
}

export function normalizePluginOptions(
  options: PluginInterface
): NormalizedOptions {
  let browser: NormalizedBrowser

  if (options.chromiumBinary) {
    browser = 'chromium-based'
  } else if (options.geckoBinary) {
    browser = 'gecko-based'
  } else {
    browser = (options.browser as NormalizedBrowser) || 'chrome'
  }

  let profile: string | false | undefined

  if (typeof options.profile === 'string') {
    const trimmed = options.profile.trim()
    if (
      /^(false|null|undefined|off|0)$/i.test(trimmed) ||
      trimmed.length === 0
    ) {
      profile = false
    } else {
      profile = trimmed
    }
  } else {
    profile = options.profile
  }

  const startingUrl = options.startingUrl || ''
  const source = options.source
  const dryRun = options.dryRun

  return {
    ...options,
    browser,
    profile,
    startingUrl,
    source,
    dryRun,
    // Ensure runtime consumers receive these values (used to derive CDP/RDP ports)
    port: options.port,
    instanceId: options.instanceId
  }
}
