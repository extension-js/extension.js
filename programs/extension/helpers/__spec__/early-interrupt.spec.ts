import {EventEmitter} from 'node:events'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  armEarlyInterrupt,
  commandNamedIn,
  earlyInterruptFrame,
  expectBuildTold,
  interruptedAfterBuildTold,
  wantsJsonFrames
} from '../early-interrupt'
import {CODES, ENVELOPE} from '../messaging'

const CLAIMED = Symbol.for('extension.js.interrupt-frame-claimed')
const ENDED = Symbol.for('extension.js.interrupt-frame-written')
// The engine sets this one as it prints that the build succeeded.
const BUILD_TOLD = Symbol.for('extension.js.build-told')
const BUILD_ENDS_RUN = Symbol.for('extension.js.build-ends-run')
const INTERRUPTED_AFTER = Symbol.for('extension.js.interrupted-after-build')
const flags = globalThis as unknown as Record<symbol, boolean | undefined>

function arm(argv: string[]) {
  const target = new EventEmitter()
  const frames: unknown[] = []
  const exits: number[] = []
  let closed = 0

  armEarlyInterrupt(['node', 'extension', ...argv], {
    target,
    write: (frame) => frames.push(frame),
    closeStream: () => {
      closed += 1
    },
    exit: (code) => exits.push(code)
  })

  return {target, frames, exits, closed: () => closed}
}

describe('the interrupt frame the entry arms', () => {
  afterEach(() => {
    delete flags[CLAIMED]
    delete flags[ENDED]
    delete flags[BUILD_TOLD]
    delete flags[BUILD_ENDS_RUN]
    delete flags[INTERRUPTED_AFTER]
  })

  it('is the envelope every other failure uses, built with no import of it', () => {
    expect(earlyInterruptFrame('build', 'SIGINT')).toEqual(
      ENVELOPE.fail(
        'build',
        'stopped',
        {
          code: CODES.E_INTERRUPTED,
          message: 'The build run was interrupted by SIGINT.'
        },
        {value: {signal: 'SIGINT'}}
      )
    )
  })

  it('loads nothing of the CLI, so arming costs a run next to nothing', () => {
    const source = readFileSync(
      join(__dirname, '..', 'early-interrupt.ts'),
      'utf8'
    )

    expect(source.match(/^import .*$/gm)).toEqual([
      "import * as fs from 'node:fs'"
    ])
  })

  it.each([
    [['build', '--output', 'json'], true],
    [['build', '--output=json'], true],
    [['build', '--format', 'json'], true],
    [['build', '--output', 'pretty'], false],
    [['build', 'json'], false],
    [['--version'], false]
  ] as const)('reads %j as json: %s', (argv, expected) => {
    expect(wantsJsonFrames(['node', 'extension', ...argv])).toBe(expected)
  })

  it.each([
    [['build', '.', '--output', 'json'], 'build'],
    [['--output', 'json', 'dev'], 'dev'],
    [['--output=json', 'start', 'dev'], 'start'],
    [['--output', 'json'], 'extension']
  ] as const)('names the command of %j as %s', (argv, expected) => {
    expect(commandNamedIn(['node', 'extension', ...argv])).toBe(expected)
  })

  it('writes no frame for a run that prints for a person, and still ends it through an exit', () => {
    const run = arm(['build'])

    run.target.emit('SIGINT')

    expect(run.frames).toEqual([])
    expect(run.closed()).toBe(0)
    // An exit runs the exit hooks, which the signal's own ending skips.
    expect(run.exits).toEqual([130])
  })

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143]
  ] as const)('on %s with no one else listening: one frame, the stream closed, exit %d', (signal, code) => {
    const run = arm(['build', '--output', 'json'])

    run.target.emit(signal)
    run.target.emit(signal)
    run.target.emit(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')

    expect(run.frames).toEqual([earlyInterruptFrame('build', signal)])
    expect(run.closed()).toBe(1)
    expect(run.exits).toEqual([code])
    expect(flags[ENDED]).toBe(true)
  })

  it('leaves the exit to a listener that owns the teardown, and runs ahead of it', () => {
    const run = arm(['build', '--output', 'json'])
    const order: string[] = []

    run.target.on('SIGINT', () =>
      order.push(`teardown after ${run.frames.length} frame`)
    )

    run.target.emit('SIGINT')

    expect(order).toEqual(['teardown after 1 frame'])
    expect(run.exits).toEqual([])
    // Gone for both signals, so no one reads it as an owner of the exit.
    expect(run.target.listenerCount('SIGTERM')).toBe(0)
  })

  it('writes nothing once a command claimed the ending, and still ends a run no one else ends', () => {
    const run = arm(['dev', '--output', 'json'])

    flags[CLAIMED] = true
    run.target.emit('SIGTERM')

    expect(run.frames).toEqual([])
    expect(run.closed()).toBe(0)
    expect(run.exits).toEqual([143])
  })

  // The build said it succeeded and nothing follows it, so the run ends by
  // itself in a moment, with the code that agrees with what it printed.
  it.each([
    ['a run that prints for a person', ['build']],
    ['a json run', ['build', '--output', 'json']]
  ] as const)('leaves %s to end by itself once the last build was told', (_name, argv) => {
    const run = arm([...argv])

    expectBuildTold(true)
    flags[BUILD_TOLD] = true
    run.target.emit('SIGINT')

    expect(run.frames).toEqual([])
    expect(run.closed()).toBe(0)
    expect(run.exits).toEqual([])
    expect(interruptedAfterBuildTold()).toBe(true)
  })

  it('still stops a run whose told build is followed by another browser', () => {
    const run = arm(['build', '--output', 'json'])

    expectBuildTold(false)
    flags[BUILD_TOLD] = true
    run.target.emit('SIGINT')

    expect(run.frames).toEqual([earlyInterruptFrame('build', 'SIGINT')])
    expect(run.exits).toEqual([130])
    expect(interruptedAfterBuildTold()).toBe(false)
  })

  it('forgets the build told before, so each browser is told on its own', () => {
    const run = arm(['build'])

    flags[BUILD_TOLD] = true
    expectBuildTold(true)
    run.target.emit('SIGTERM')

    expect(run.exits).toEqual([143])
  })
})
