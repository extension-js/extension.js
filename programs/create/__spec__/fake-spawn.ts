import type {ChildProcess, SpawnOptions} from 'node:child_process'
import {EventEmitter} from 'node:events'
import type {SpawnProcess} from '../lib/install-runner'

// What one spawned child does. A child with no exit and no error never ends,
// which is how a hung package manager looks to the runner.
export interface FakeRun {
  exit?: number | null
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
      signals: []
    }
    calls.push(call)

    const piped = (index: number) =>
      options.stdio === 'pipe' ||
      (Array.isArray(options.stdio) && options.stdio[index] === 'pipe')
    const child = Object.assign(new EventEmitter(), {
      pid: call.pid,
      stdout: piped(1) ? new EventEmitter() : null,
      stderr: piped(2) ? new EventEmitter() : null,
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
      if (run.exit !== undefined) child.emit('close', run.exit)
    })

    return child as unknown as ChildProcess
  }

  return {spawn, calls}
}
