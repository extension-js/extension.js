// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {DevOptions} from '../webpack-types'
import {computeBinariesBaseDir} from './browsers-lib/output-binaries-resolver'
import {printProdBannerOnce} from './browsers-lib/banner'
import {createChromiumContext} from './run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from './run-chromium/chromium-launch'
import {createFirefoxContext} from './run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from './run-firefox/firefox-launch'

/**
 * Lightweight run-only entrypoint for `preview`.
 *
 * IMPORTANT:
 * - Does not compile.
 * - Does not depend on a real bundler compiler/compilation object.
 * - Uses a minimal "compilation-like" shape to reuse existing runner code paths.
 */
export async function runOnlyPreviewBrowser(opts: {
  browser: DevOptions['browser']
  outPath: string
  contextDir: string
  // Additional unpacked extension dirs to load before the user extension.
  // (Companion extensions: devtools/theme + user-provided companions)
  extensionsToLoad: string[]
  // Forwarded options (subset)
  noOpen?: boolean
  profile?: string | false
  persistProfile?: boolean
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  startingUrl?: string
  chromiumBinary?: string
  geckoBinary?: string
  instanceId?: string
  port?: number | string
  dryRun?: boolean
}): Promise<void> {
  // In preview we intentionally do not support source inspection unless we decide to ship `ws`.
  // Guard here for clarity and to keep preview dependency footprint minimal.
  const sourceEnabled = false

  const compilationLike: any = {
    options: {
      mode: 'production',
      context: opts.contextDir,
      output: {path: opts.outPath}
    },
    errors: []
  }

  // Provide shared cache dir guidance to the runner (pretty install hints).
  // This matches the behavior expected by the chromium launcher guidance printer.
  computeBinariesBaseDir(compilationLike)

  // Create a minimal options object matching the browser launch contract.
  const common: any = {
    extension: opts.extensionsToLoad,
    browser: opts.browser,
    noOpen: opts.noOpen,
    profile: opts.profile,
    persistProfile: opts.persistProfile,
    preferences: opts.preferences,
    browserFlags: opts.browserFlags,
    excludeBrowserFlags: opts.excludeBrowserFlags,
    startingUrl: opts.startingUrl,
    chromiumBinary: opts.chromiumBinary,
    geckoBinary: opts.geckoBinary,
    instanceId: opts.instanceId,
    port: opts.port,
    // Hard-disable inspection in run-only preview for now
    source: sourceEnabled ? (opts as any).source : undefined,
    watchSource: sourceEnabled ? (opts as any).watchSource : undefined,
    dryRun: opts.dryRun
  }

  if (
    opts.browser === 'chrome' ||
    opts.browser === 'edge' ||
    opts.browser === 'chromium' ||
    opts.browser === 'chromium-based'
  ) {
    // Run Chromium launch without CDP post-launch wiring (keeps `ws` optional).
    const ctx = createChromiumContext()
    const launcher = new ChromiumLaunchPlugin(common, ctx)
    await launcher.runOnce(compilationLike, {enableCdpPostLaunch: false})
    await printProdBannerOnce({browser: opts.browser, outPath: opts.outPath})
    return
  }

  if (
    opts.browser === 'firefox' ||
    opts.browser === 'gecko-based' ||
    opts.browser === 'firefox-based'
  ) {
    const ctx = createFirefoxContext()
    const launcher = new FirefoxLaunchPlugin(common, ctx)
    await launcher.runOnce(compilationLike, {
      browser: opts.browser as any,
      mode: 'production',
      profile: opts.profile,
      persistProfile: opts.persistProfile,
      preferences: opts.preferences,
      browserFlags: opts.browserFlags,
      excludeBrowserFlags: opts.excludeBrowserFlags,
      startingUrl: opts.startingUrl,
      geckoBinary: opts.geckoBinary,
      port: opts.port
    } as any)
    return
  }

  throw new Error(`Unsupported browser: ${String(opts.browser)}`)
}

