// ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  isChromiumBrowser,
  isFirefoxBrowser
} from '../browsers/browsers-lib/browser-family'
import * as messages from './messages'
import {isEmulatorVendor, vendors} from './vendors'

export interface BinaryFlagBrowser {
  // The browser to run, or undefined for the stock default.
  browser?: string
  // The plain usage refusal, when a typed binary flag would be dropped.
  refusal?: string
}

type Engine = {
  flag: '--chromium-binary' | '--gecko-binary'
  name: 'Chromium' | 'Gecko'
  target: 'chromium-based' | 'gecko-based'
  runs: (browser: string) => boolean
}

const CHROMIUM: Engine = {
  flag: '--chromium-binary',
  name: 'Chromium',
  target: 'chromium-based',
  // The emulator is a Chromium the launcher starts, so the pin reaches it.
  runs: (browser) => isChromiumBrowser(browser) || isEmulatorVendor(browser)
}

const GECKO: Engine = {
  flag: '--gecko-binary',
  name: 'Gecko',
  target: 'gecko-based',
  runs: isFirefoxBrowser
}

function runsEngine(browser: string, engine: Engine): boolean {
  return vendors(browser as never).some((vendor) => engine.runs(vendor))
}

// A typed binary flag is never dropped: with no --browser it picks its own
// engine, and beside a --browser of the other engine the run is refused.
export function browserForBinaryFlags(opts: {
  typedBrowser?: string
  configBrowser?: string
  chromiumBinary?: string
  geckoBinary?: string
}): BinaryFlagBrowser {
  const pinned = [
    ...(opts.chromiumBinary ? [CHROMIUM] : []),
    ...(opts.geckoBinary ? [GECKO] : [])
  ]

  // An empty --browser stays typed, for the browser check to refuse.
  if (opts.typedBrowser !== undefined) {
    const typed = opts.typedBrowser
    const dropped = pinned.find((engine) => !runsEngine(typed, engine))

    return {
      browser: typed,
      refusal: dropped
        ? messages.binaryFlagOtherEngine(
            dropped.flag,
            dropped.name,
            typed,
            dropped.target
          )
        : undefined
    }
  }

  const fromConfig = opts.configBrowser

  if (fromConfig && pinned.every((engine) => runsEngine(fromConfig, engine))) {
    return {browser: fromConfig}
  }

  if (pinned.length > 1) {
    return {browser: fromConfig, refusal: messages.binaryFlagsNeedBrowser()}
  }

  // Chromium is the stock engine, so its binary alone keeps the stock name.
  if (pinned[0] === CHROMIUM && !fromConfig) return {}

  return {browser: pinned[0]?.target ?? fromConfig}
}
