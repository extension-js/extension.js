import * as os from 'os'
import * as path from 'path'
import type {DevOptions} from '../../webpack-types'
import {PluginInterface} from '../browsers-types'

export type NormalizedBrowser = DevOptions['browser']

export interface NormalizedOptions extends Omit<PluginInterface, 'browser'> {
  browser: NormalizedBrowser
  noOpen?: boolean
  profile?: string | false
  startingUrl?: string
  source?: string
  dryRun?: boolean
}

export function normalizePluginOptions(
  options: PluginInterface
): NormalizedOptions {
  let browser: NormalizedBrowser | 'chromium' | 'firefox'

  // Normalize user-provided binary paths: expand ~ and strip surrounding quotes
  const normalizePath = (filePath?: string) => {
    if (!filePath) return filePath
    let normalizedPath = String(filePath).trim()
    if (
      (filePath.startsWith('"') && filePath.endsWith('"')) ||
      (filePath.startsWith("'") && filePath.endsWith("'"))
    ) {
      filePath = filePath.slice(1, -1)
    }
    if (normalizedPath.startsWith('~')) {
      normalizedPath = path.join(os.homedir(), normalizedPath.slice(1))
    }
    return normalizedPath
  }

  const chromiumBinary = normalizePath(options.chromiumBinary)
  const geckoBinary = normalizePath(options.geckoBinary)

  if (chromiumBinary) {
    // When a Chromium binary hint is provided, treat selection as engine-based
    // to enable engine-specific behavior downstream.
    browser = 'chromium-based'
  } else if (geckoBinary) {
    // Same for Gecko engine-based selections.
    browser = 'gecko-based'
  } else {
    browser = (options.browser as NormalizedBrowser) || 'chromium'
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

  const browserFlags =
    options.browserFlags?.filter(
      (flag) => !flag.startsWith('--load-extension=')
    ) || []

  const excludeBrowserFlags =
    options.excludeBrowserFlags?.filter(
      (flag) => !flag.startsWith('--load-extension=')
    ) || []

  return {
    ...options,
    browser,
    chromiumBinary,
    geckoBinary,
    profile,
    startingUrl,
    source,
    dryRun,
    browserFlags,
    excludeBrowserFlags,
    // Ensure runtime consumers receive these values (used to derive CDP/RDP ports)
    port: options.port,
    instanceId: options.instanceId
  }
}
