import {EventEmitter} from 'node:events'
import {describe, expect, it} from 'vitest'
import {
  type InterruptSignalTarget,
  interruptedFrame,
  writeFrameWhenInterrupted
} from '../session-interrupt-frame'

function armed(command: 'preview' | 'start' = 'preview') {
  const target = new EventEmitter()
  const frames: unknown[] = []
  const exits: number[] = []
  const disarm = writeFrameWhenInterrupted(
    command,
    () => ({projectPath: '/proj', browsers: ['chrome']}),
    (frame) => frames.push(frame),
    target as unknown as InterruptSignalTarget,
    (code) => exits.push(code)
  )

  return {target, frames, exits, disarm}
}

describe('the frame a run-only session ends its json stream with', () => {
  it.each([
    ['preview', 'SIGINT'],
    ['start', 'SIGTERM']
  ] as const)('is %s stopped with E_INTERRUPTED and names %s', (command, signal) => {
    expect(interruptedFrame(command, signal, {projectPath: '/proj'})).toEqual({
      schema: 1,
      ok: false,
      command,
      status: 'stopped',
      value: {projectPath: '/proj', signal},
      error: {
        code: 'E_INTERRUPTED',
        message: `The ${command} session was interrupted by ${signal}.`
      },
      warnings: []
    })
  })

  it('is written before a teardown that was registered earlier, and leaves the exit to it', () => {
    const session = new EventEmitter()
    const framesTheTeardownSaw: number[] = []
    const written: unknown[] = []
    const exits: number[] = []

    session.on('SIGINT', () => framesTheTeardownSaw.push(written.length))
    writeFrameWhenInterrupted(
      'preview',
      () => ({}),
      (frame) => written.push(frame),
      session as unknown as InterruptSignalTarget,
      (code) => exits.push(code)
    )

    session.emit('SIGINT')

    expect(framesTheTeardownSaw).toEqual([1])
    expect(exits).toEqual([])
  })

  it('writes one frame for a SIGINT followed by a SIGTERM', () => {
    const {target, frames} = armed('start')

    target.on('SIGINT', () => {})
    target.on('SIGTERM', () => {})
    target.emit('SIGINT')
    target.emit('SIGTERM')
    target.emit('SIGINT')

    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      command: 'start',
      value: {signal: 'SIGINT'}
    })
  })

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143]
  ] as const)('ends the run as %s would when no teardown is registered yet', (signal, code) => {
    const {target, frames, exits} = armed()

    target.emit(signal)

    expect(frames).toHaveLength(1)
    expect(exits).toEqual([code])
  })

  it('writes nothing once disarmed', () => {
    const {target, frames, exits, disarm} = armed()

    disarm()
    target.emit('SIGINT')
    target.emit('SIGTERM')

    expect(frames).toEqual([])
    expect(exits).toEqual([])
  })
})
