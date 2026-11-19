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

export function safariResyncFailed(reason: string) {
  return (
    `${prefix('error')} Safari couldn't take the rebuilt extension, so it still runs the previous build.\n` +
    `${stripChannelPrefix(reason)}\n` +
    `The dev server keeps watching, and the next save packages it again.`
  )
}
