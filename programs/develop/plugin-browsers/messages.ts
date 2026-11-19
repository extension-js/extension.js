// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {browserDisplayName, prefix, stripChannelPrefix} from '../lib/messaging'

export function browserLogCaptureFailed(browser: string, reason: string) {
  return (
    `${prefix('warn')} ${browserDisplayName(browser)} is running with the extension, but its logs could not be captured.\n` +
    `${stripChannelPrefix(reason)}\n` +
    `The session carries on without browser logs.`
  )
}

function minutes(ms: number) {
  const count = Math.max(1, Math.round(ms / 60_000))

  return `${count} minute${count === 1 ? '' : 's'}`
}

// A reason inside the launch failure frame, so it carries no glyph of its own.
export function browserLaunchTimedOut(ms: number) {
  return `The launch did not finish within ${minutes(ms)}, so the dev server stopped waiting for it. A browser that opens later is still picked up.`
}

export function browserLogCaptureTimedOut(ms: number) {
  return `The browser did not answer the request to capture logs within ${minutes(ms)}.`
}

export function safariFirstPackageTimedOut(ms: number) {
  return `The Safari package did not finish within ${minutes(ms)}, so the dev server stopped waiting for it. A package that finishes later is still picked up.`
}

export function safariResyncFailed(reason: string) {
  return (
    `${prefix('error')} Safari couldn't take the rebuilt extension, so it still runs the previous build.\n` +
    `${stripChannelPrefix(reason)}\n` +
    `The dev server keeps watching, and the next save packages it again.`
  )
}
