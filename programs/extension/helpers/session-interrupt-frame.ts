//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {claimInterruptFrame} from './early-interrupt'
import {exitAfterDrain} from './exit-after-drain'
import {CODES, ENVELOPE} from './messaging'
import {
  signalExitCode,
  TERMINATION_SIGNALS,
  type TerminationSignal
} from './telemetry-signals'

export interface InterruptSignalTarget {
  prependOnceListener(signal: TerminationSignal, listener: () => void): unknown
  removeListener(signal: TerminationSignal, listener: () => void): unknown
  listenerCount(signal: TerminationSignal): number
}

// A run-only session told to stop ends its json stream with one coded frame,
// as a dev session does. A stream that just ends leaves a reader guessing.
export function interruptedFrame(
  command: 'preview' | 'start',
  signal: TerminationSignal,
  value: Record<string, unknown>
) {
  return ENVELOPE.fail(
    command,
    'stopped',
    {
      code: CODES.E_INTERRUPTED,
      message: `The ${command} session was interrupted by ${signal}.`
    },
    {value: {...value, signal}}
  )
}

// Writes that frame on the first signal and leaves the exit to whoever owns
// the teardown. Put first, so a teardown that exits at once runs after it.
export function writeFrameWhenInterrupted(
  command: 'preview' | 'start',
  value: () => Record<string, unknown>,
  write: (frame: unknown) => void,
  target: InterruptSignalTarget = process,
  exit: (code: number) => unknown = (code) => exitAfterDrain(code)
): () => void {
  claimInterruptFrame()

  let written = false
  const listeners = TERMINATION_SIGNALS.map((signal) => {
    const listener = () => {
      if (!written) {
        written = true
        write(interruptedFrame(command, signal, value()))
      }

      // A listener takes the signal's own ending away. With no teardown
      // registered yet nothing else ends the run, so this does, as the signal.
      if (target.listenerCount(signal) === 0) void exit(signalExitCode(signal))
    }

    target.prependOnceListener(signal, listener)

    return [signal, listener] as const
  })

  return () => {
    for (const [signal, listener] of listeners) {
      target.removeListener(signal, listener)
    }
  }
}
