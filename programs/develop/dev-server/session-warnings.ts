// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {onCodedWarning} from '../lib/coded-warnings'
import type {ErrorCode} from '../lib/messaging'

interface SessionWarningTargets {
  lifecycle: {warned: (args: {code: ErrorCode; message: string}) => unknown}
  metadata: {writeWarning: (args: {code: string; message: string}) => void}
  // What a warning names when it belongs to one session of the process.
  broker: object
}

// From the call on, a warning is reported when it is known, in the stream
// and in the event log. One that names another session's broker is skipped.
export function reportSessionWarnings(
  targets: SessionWarningTargets
): () => void {
  return onCodedWarning((code, message, owner) => {
    if (owner && owner !== targets.broker) return

    targets.lifecycle.warned({code, message})
    targets.metadata.writeWarning({code, message})
  })
}
