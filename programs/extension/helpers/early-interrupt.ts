//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'

// Loaded first by the entry, ahead of every command, so it imports nothing
// of ours: what it costs is paid by each run, a --version included.
type TerminationSignal = 'SIGINT' | 'SIGTERM'

const SIGNALS: Record<TerminationSignal, number> = {SIGINT: 2, SIGTERM: 15}

// Shared with the engine, which cannot import the CLI: a global symbol both
// sides can read says a command took over the frame a signal ends with.
const CLAIMED = Symbol.for('extension.js.interrupt-frame-claimed')
const ENDED = Symbol.for('extension.js.interrupt-frame-written')

const flags = globalThis as unknown as Record<symbol, boolean | undefined>

export function claimInterruptFrame(): void {
  flags[CLAIMED] = true
}

export function interruptFrameClaimed(): boolean {
  return flags[CLAIMED] === true
}

// True once the fallback closed the stream, so no later frame follows it.
export function streamEndedByInterrupt(): boolean {
  return flags[ENDED] === true
}

export function wantsJsonFrames(argv: string[]): boolean {
  return argv.some((arg, index) =>
    arg === '--output' || arg === '--format'
      ? argv[index + 1] === 'json'
      : arg === '--output=json' || arg === '--format=json'
  )
}

export function commandNamedIn(argv: string[]): string {
  const args = argv.slice(2)

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--output' || arg === '--format') index += 1
    else if (!arg.startsWith('-')) return arg
  }

  return 'extension'
}

export function earlyInterruptFrame(
  command: string,
  signal: TerminationSignal
) {
  return {
    schema: 1,
    ok: false,
    command,
    status: 'stopped',
    value: {signal},
    error: {
      code: 'E_INTERRUPTED',
      message: `The ${command} run was interrupted by ${signal}.`
    },
    warnings: []
  }
}

export interface EarlyInterruptTarget {
  prependOnceListener(signal: TerminationSignal, listener: () => void): unknown
  removeListener(signal: TerminationSignal, listener: () => void): unknown
  listenerCount(signal: TerminationSignal): number
}

export interface EarlyInterruptDeps {
  target: EarlyInterruptTarget
  write: (frame: unknown) => void
  closeStream: () => void
  exit: (code: number) => void
}

const processDeps: EarlyInterruptDeps = {
  target: process,
  write: (frame) => {
    fs.writeSync(1, `${JSON.stringify(frame)}\n`)
  },
  // The run may still be working when the signal lands. Whatever it prints
  // after the stopped frame would be a second ending.
  closeStream: () => {
    process.stdout.write = () => true
  },
  exit: (code) => process.exit(code)
}

// A json run told to stop before its command owns the signal still ends with
// one stopped frame. A command that frames its own ending claims it first.
// Every run gets the exit: one that ends through it runs its exit hooks, and
// one killed by the signal's own action runs none.
export function armEarlyInterrupt(
  argv: string[],
  deps: EarlyInterruptDeps = processDeps
): void {
  const json = wantsJsonFrames(argv)

  const listeners = new Map<TerminationSignal, () => void>()

  const disarm = () => {
    for (const [signal, listener] of listeners) {
      deps.target.removeListener(signal, listener)
    }
  }

  for (const signal of Object.keys(SIGNALS) as TerminationSignal[]) {
    const listener = () => {
      // Both go, so the listener of the other signal never reads as an owner.
      disarm()

      if (json && !interruptFrameClaimed()) {
        flags[ENDED] = true

        try {
          deps.write(earlyInterruptFrame(commandNamedIn(argv), signal))
        } catch {
          // A closed pipe has no reader left to tell.
        }

        deps.closeStream()
      }

      // A listener takes the signal's own ending away, so with no one else
      // registered yet this ends the run, with the code the shell reports.
      if (deps.target.listenerCount(signal) === 0) {
        deps.exit(128 + SIGNALS[signal])
      }
    }

    listeners.set(signal, listener)
    deps.target.prependOnceListener(signal, listener)
  }
}
