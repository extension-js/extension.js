import type {ChildProcess, SpawnOptions} from 'node:child_process'
import {EventEmitter} from 'node:events'
import type {SpawnProcess} from '../lib/install-runner'

// What one spawned child does. A child with no exit and no error never ends,
// which is how a hung package manager looks to the runner.
export interface FakeRun {
  exit?: number | null
  // The signal that ended the child, reported with a null exit.
  signal?: NodeJS.Signals
  stdout?: string
  stderr?: string
  error?: Error
}

export interface SpawnCall {
  command: string
  args: string[]
  options: SpawnOptions
  pid: number
  signals: string[]
  // Which of the child's pipes the runner closed on its side.
  destroyed: Array<'stdout' | 'stderr'>
}

// The error Node and cross-spawn both raise for a binary that is not on PATH.
export function missingBinary(command: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`spawn ${command} ENOENT`), {
    code: 'ENOENT',
    errno: -2,
    syscall: `spawn ${command}`,
    path: command
  })
}

// Stands in for cross-spawn through the seam, so no process ever starts and
// each child ends the way the script says.
export function fakeSpawn(
  script: (command: string, args: string[]) => FakeRun
): {spawn: SpawnProcess; calls: SpawnCall[]} {
  const calls: SpawnCall[] = []

  const spawn: SpawnProcess = (command, args, options) => {
    const run = script(command, args)
    const call: SpawnCall = {
      command,
      args,
      options,
      pid: 4000 + calls.length,
      signals: [],
      destroyed: []
    }
    calls.push(call)

    const piped = (index: number) =>
      options.stdio === 'pipe' ||
      (Array.isArray(options.stdio) && options.stdio[index] === 'pipe')
    const pipe = (name: 'stdout' | 'stderr') =>
      Object.assign(new EventEmitter(), {
        destroy() {
          call.destroyed.push(name)
        }
      })
    const child = Object.assign(new EventEmitter(), {
      pid: call.pid,
      stdout: piped(1) ? pipe('stdout') : null,
      stderr: piped(2) ? pipe('stderr') : null,
      unref() {},
      kill(signal?: string) {
        call.signals.push(String(signal))

        return true
      }
    })

    // Output is written as the child starts, so a child that then hangs has
    // already said what it was waiting on.
    queueMicrotask(() => {
      if (run.error) {
        child.emit('error', run.error)

        return
      }

      if (run.stdout) child.stdout?.emit('data', Buffer.from(run.stdout))
      if (run.stderr) child.stderr?.emit('data', Buffer.from(run.stderr))

      if (run.exit !== undefined) {
        child.emit('close', run.exit, run.signal ?? null)
      }
    })

    return child as unknown as ChildProcess
  }

  return {spawn, calls}
}
