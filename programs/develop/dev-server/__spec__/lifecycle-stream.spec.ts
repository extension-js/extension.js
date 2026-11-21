import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {recordCodedWarning, takeCodedWarnings} from '../../lib/coded-warnings'
import {CODES, humanLine} from '../../lib/messaging'
import {
  attachLifecycleStream,
  createLifecycleStream,
  isLifecycleStreamEnabled,
  isMachineOutput
} from '../lifecycle-stream'

type Frame = {
  schema: number
  ok: boolean
  command: string
  status: string
  value: Record<string, unknown> | null
  error: {code: string; message: string; details?: unknown[]} | null
  warnings: string[]
  truncated?: boolean
}

function makeStream(
  options: {
    readyPath?: string
    noBrowser?: boolean
    hintFor?: (code: string) => string | undefined
    onUsageRefusal?: (code: string, message: string) => void
  } = {}
) {
  const lines: string[] = []
  const stream = createLifecycleStream({
    command: 'dev',
    browser: 'chromium',
    distPath: '/proj/dist/chromium',
    readyPath: options.readyPath,
    eventsPath: '/proj/.extension-js/chromium/events.ndjson',
    noBrowser: options.noBrowser,
    hintFor: options.hintFor,
    onUsageRefusal: options.onUsageRefusal,
    write: (line) => lines.push(line)
  })

  return {stream, lines}
}

// Every frame must independently parse as one schema-1 envelope on its own line.
function parseFrames(lines: string[]): Frame[] {
  return lines.map((line) => {
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1).includes('\n')).toBe(false)
    const frame = JSON.parse(line) as Frame
    expect(frame.schema).toBe(1)
    expect(frame.command).toBe('dev')
    expect(typeof frame.status).toBe('string')
    expect(Array.isArray(frame.warnings)).toBe(true)
    // ok === false is exactly the same thing as error !== null.
    expect(frame.ok).toBe(frame.error == null)

    return frame
  })
}

function fakeStats(options: {
  errors?: boolean
  assets?: number
  entrypoints?: number
  durationMs?: number
  text?: string
  issues?: unknown[]
}) {
  const assets = Array.from({length: options.assets ?? 0}, (_, i) => ({
    name: `asset-${i}.js`
  }))
  const entrypoints = Object.fromEntries(
    Array.from({length: options.entrypoints ?? 0}, (_, i) => [`entry-${i}`, {}])
  )

  return {
    hasErrors: () => Boolean(options.errors),
    toString: () => options.text ?? '',
    ...(options.entrypoints === undefined
      ? {}
      : {toJson: () => ({entrypoints})}),
    compilation: {
      startTime: 0,
      endTime: options.durationMs ?? 0,
      getAssets: () => assets,
      errors: options.issues ?? [],
      warnings: [],
      compiler: {context: '/proj'}
    }
  }
}

function fakeCompiler() {
  const taps: Record<string, (arg: unknown) => void> = {}

  return {
    taps,
    hooks: {
      done: {
        tap: (_name: string, fn: (stats: unknown) => void) => {
          taps.done = fn
        }
      },
      failed: {
        tap: (_name: string, fn: (error: unknown) => void) => {
          taps.failed = fn
        }
      }
    }
  }
}

describe('lifecycle stream trigger', () => {
  const original = process.env.EXTENSION_OUTPUT

  afterEach(() => {
    if (original === undefined) delete process.env.EXTENSION_OUTPUT
    else process.env.EXTENSION_OUTPUT = original
  })

  it('is off by default and on for EXTENSION_OUTPUT=json or ndjson', () => {
    delete process.env.EXTENSION_OUTPUT
    expect(isLifecycleStreamEnabled()).toBe(false)
    expect(isMachineOutput()).toBe(false)
    process.env.EXTENSION_OUTPUT = 'pretty'
    expect(isLifecycleStreamEnabled()).toBe(false)
    // An unrecognized value stays pretty rather than swallowing human output.
    process.env.EXTENSION_OUTPUT = 'yaml'
    expect(isLifecycleStreamEnabled()).toBe(false)
    process.env.EXTENSION_OUTPUT = 'json'
    expect(isLifecycleStreamEnabled()).toBe(true)
    process.env.EXTENSION_OUTPUT = 'NDJSON'
    expect(isLifecycleStreamEnabled()).toBe(true)
    process.env.EXTENSION_OUTPUT = ' ndjson '
    expect(isLifecycleStreamEnabled()).toBe(true)
  })

  it('emits no frame at all in pretty mode', () => {
    delete process.env.EXTENSION_OUTPUT
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8081})
    stream.compiled({assets: 3, durationMs: 10})
    stream.ready()
    stream.compileFailed({output: 'boom'})
    stream.compiled({assets: 3, durationMs: 10})
    stream.browserExited()
    stream.failed('nope')
    expect(lines).toEqual([])
  })

  it('routes human copy to console.log in pretty mode', () => {
    delete process.env.EXTENSION_OUTPUT
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    humanLine('a pretty line')
    expect(log).toHaveBeenCalledWith('a pretty line')
    expect(err).not.toHaveBeenCalled()
    log.mockRestore()
    err.mockRestore()
  })

  it('streams frames and moves human copy for EXTENSION_OUTPUT=json too', () => {
    process.env.EXTENSION_OUTPUT = 'json'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8080})
    humanLine('a machine-mode line')
    expect(parseFrames(lines).map((frame) => frame.status)).toEqual([
      'starting'
    ])

    expect(log).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith('a machine-mode line\n')
    log.mockRestore()
    err.mockRestore()
  })

  it('routes human copy to stderr while the stream is on', () => {
    process.env.EXTENSION_OUTPUT = 'ndjson'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    humanLine('a machine-mode line')
    expect(log).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith('a machine-mode line\n')
    log.mockRestore()
    err.mockRestore()
  })
})

describe('lifecycle stream transitions', () => {
  const original = process.env.EXTENSION_OUTPUT

  beforeEach(() => {
    process.env.EXTENSION_OUTPUT = 'ndjson'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.EXTENSION_OUTPUT
    else process.env.EXTENSION_OUTPUT = original
  })

  it('emits exactly one starting frame carrying the requested port', () => {
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8081})
    expect(lines).toHaveLength(1)
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('starting')
    expect(frame.ok).toBe(true)
    expect(frame.value?.requestedPort).toBe(8080)
    expect(frame.value?.port).toBe(8081)
    expect(frame.value?.pid).toBe(process.pid)
  })

  it('warns with the declared code when the requested port was taken', () => {
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8081})
    const [frame] = parseFrames(lines)
    expect(frame.warnings).toEqual([
      'W_PORT_IN_USE: port 8080 was taken, so the dev server listens on port 8081'
    ])
  })

  it('leaves the starting frame unwarned when the requested port was free', () => {
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8080})
    expect(parseFrames(lines)[0].warnings).toEqual([])
  })

  it('leaves the starting frame unwarned when no port was requested', () => {
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: Number.NaN, port: 8081})
    expect(parseFrames(lines)[0].warnings).toEqual([])
  })

  it('emits exactly one compiled frame with assets and duration', () => {
    const {stream, lines} = makeStream()
    stream.compiled({assets: 7, durationMs: 421})
    expect(lines).toHaveLength(1)
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('compiled')
    expect(frame.value?.assets).toBe(7)
    expect(frame.value?.durationMs).toBe(421)
  })

  it('carries what the session warned about since its last frame', () => {
    const {stream, lines} = makeStream()
    takeCodedWarnings()
    stream.compiled({assets: 1, durationMs: 5})
    recordCodedWarning(
      CODES.W_RELOAD_NOT_APPLIED,
      'content_script (a.ts) compiled but the extension never confirmed the reload'
    )

    stream.compiled({assets: 1, durationMs: 6})
    recordCodedWarning(
      CODES.W_RELOAD_NOT_APPLIED,
      'content_script (a.ts) reloaded but the extension has not come back since'
    )

    stream.compileFailed({output: 'broken', durationMs: 7})
    stream.compiled({assets: 1, durationMs: 8})

    expect(
      parseFrames(lines).map((frame) => [frame.status, frame.warnings])
    ).toEqual([
      ['compiled', []],
      [
        'recompiled',
        [
          'W_RELOAD_NOT_APPLIED: content_script (a.ts) compiled but the extension never confirmed the reload'
        ]
      ],
      [
        'compile-failed',
        [
          'W_RELOAD_NOT_APPLIED: content_script (a.ts) reloaded but the extension has not come back since'
        ]
      ],
      ['recompiled', []]
    ])
  })

  it('emits recompiled for every successful compile after the first', () => {
    const {stream, lines} = makeStream()
    stream.compiled({assets: 1, durationMs: 5})
    stream.compiled({assets: 1, durationMs: 6})
    stream.compiled({assets: 1, durationMs: 7})
    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual([
      'compiled',
      'recompiled',
      'recompiled'
    ])
  })

  it('codes the first failed compile E_FIRST_COMPILE and later ones E_COMPILE', () => {
    const {stream, lines} = makeStream()
    stream.compileFailed({output: 'Module not found: ./missing'})
    stream.compiled({assets: 2, durationMs: 9})
    stream.compileFailed({output: 'Module not found: ./missing-again'})
    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual([
      'compile-failed',
      'compiled',
      'compile-failed'
    ])

    expect(frames[0].ok).toBe(false)
    expect(frames[0].error?.code).toBe('E_FIRST_COMPILE')
    expect(frames[0].value?.output).toBe('Module not found: ./missing')
    expect(frames[2].error?.code).toBe('E_COMPILE')
    expect(frames[2].value?.output).toBe('Module not found: ./missing-again')
  })

  it('strips ANSI and truncates long compiler output', () => {
    const {stream, lines} = makeStream()
    const esc = String.fromCharCode(27)
    const colored = `${esc}[31m${'x'.repeat(4000)}${esc}[39m`
    stream.compileFailed({output: colored})
    const [frame] = parseFrames(lines)
    const output = String(frame.value?.output)
    expect(output).not.toContain(esc)
    expect(output.length).toBe(2001)
    expect(frame.truncated).toBe(true)
  })

  it('warns on the ready frame with the CDP fault the launcher stamped', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        schemaVersion: 2,
        status: 'ready',
        runId: 'run-abc',
        port: 8081,
        pid: 4242,
        cdpFaultCode: 'W_CDP_TIMEOUT',
        cdpFaultMessage: 'ensureLoaded timeout (10000ms)'
      })
    )

    const {stream, lines} = makeStream({readyPath})
    stream.ready()
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('ready')
    expect(frame.ok).toBe(true)
    expect(frame.warnings).toEqual([
      'W_CDP_TIMEOUT: ensureLoaded timeout (10000ms)'
    ])

    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('reads a fault an older launcher stamped under its E_ name as the warning', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        schemaVersion: 2,
        status: 'ready',
        runId: 'run-abc',
        port: 8081,
        pid: 4242,
        cdpFaultCode: 'E_CDP_TIMEOUT',
        cdpFaultMessage: 'ensureLoaded timeout (10000ms)'
      })
    )

    const {stream, lines} = makeStream({readyPath})
    stream.ready()
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('ready')
    expect(frame.ok).toBe(true)
    expect(frame.warnings).toEqual([
      'W_CDP_TIMEOUT: ensureLoaded timeout (10000ms)'
    ])

    fs.rmSync(dir, {recursive: true, force: true})
  })

  // The frame names one of the five CDP fault warnings and no other code,
  // whatever an older launcher or a hand-edited contract stamped.
  it.each([
    ['E_COMPILE', ['W_CDP_OP_FAILED: detail']],
    ['E_INTERNAL', ['W_CDP_OP_FAILED: detail']],
    ['E_ASSET_MISSING', ['W_CDP_OP_FAILED: detail']],
    ['W_INTERNAL', ['W_CDP_OP_FAILED: detail']],
    ['W_EXTENSION_ID_UNKNOWN', ['W_EXTENSION_ID_UNKNOWN: detail']],
    ['E_BROWSER_CONNECTION_CLOSED', ['W_BROWSER_CONNECTION_CLOSED: detail']],
    ['ENOENT', ['W_CDP_OP_FAILED: detail']],
    ['', []],
    ['   ', []]
  ])('reads a stamped cdpFaultCode of "%s" as %j', (cdpFaultCode, warnings) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        schemaVersion: 2,
        status: 'ready',
        runId: 'run-abc',
        port: 8081,
        pid: 4242,
        cdpFaultCode,
        cdpFaultMessage: 'detail'
      })
    )

    const {stream, lines} = makeStream({readyPath})
    stream.ready()
    const [frame] = parseFrames(lines)
    expect(frame.ok).toBe(true)
    expect(frame.warnings).toEqual(warnings)

    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('emits the ready frame once, with the contract projection', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        schemaVersion: 2,
        status: 'ready',
        runId: 'run-abc',
        port: 8081,
        pid: 4242,
        toolchainVersion: '4.0.16'
      })
    )

    const {stream, lines} = makeStream({readyPath})
    stream.ready()
    stream.ready()
    expect(lines).toHaveLength(1)
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('ready')
    expect(frame.value?.runId).toBe('run-abc')
    expect(frame.value?.port).toBe(8081)
    expect(frame.value?.pid).toBe(process.pid)
    expect(frame.value?.readyPath).toBe(readyPath)
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('keeps the stream open past a launch that failed, since the next compile tries again', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'browser_launch_failed',
        message: 'spawn /nowhere/chrome EACCES'
      })
    )

    const {stream, lines} = makeStream({readyPath})
    stream.ready()
    stream.ready()

    // The next compile tried and the launcher refused a pin, with its code.
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_BROWSER_BINARY_INVALID',
        browserLaunchFailedAt: '2026-10-03T00:00:05.000Z',
        message: 'bad pin'
      })
    )

    stream.ready()
    stream.interrupted('SIGINT')
    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual([
      'ready-failed',
      'ready-failed',
      'stopped'
    ])

    expect(frames[1].error?.code).toBe('E_BROWSER_BINARY_INVALID')
    // The code --wait and the exit frame give the same contract state.
    expect(frames[0].error?.code).toBe('E_BROWSER_LAUNCH')
    expect(frames[0].value?.readyCode).toBe('browser_launch_failed')
    expect((frames[0] as {hint?: string}).hint).toContain(
      'the next compile tries the launch again'
    )

    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('ends on usage, and tells the host, when a launch is refused over a value the user set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_FLAG_NOT_SUPPORTED_HERE',
        browserLaunchFailedAt: '2026-10-03T00:00:05.000Z',
        message: 'system profile mode'
      })
    )

    const ended: string[] = []
    const {stream, lines} = makeStream({
      readyPath,
      onUsageRefusal: (code, message) => ended.push(`${code} ${message}`)
    })
    stream.ready()
    stream.interrupted('SIGINT')
    const frames = parseFrames(lines)

    expect(frames.map((frame) => frame.status)).toEqual(['usage'])
    expect(frames[0].error?.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
    expect(frames[0].value?.readyCode).toBe('browser_launch_failed')
    expect(ended).toEqual(['E_FLAG_NOT_SUPPORTED_HERE system profile mode'])

    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('reports a contract error the session survives without ending the stream', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'compile_error',
        message: 'the compile failed'
      })
    )

    const {stream, lines} = makeStream({readyPath})
    stream.ready()
    stream.ready()
    expect(lines).toHaveLength(1)
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('ready-failed')
    expect(frame.ok).toBe(false)
    expect(frame.error?.code).toBe('E_COMPILE')
    expect(frame.value?.readyCode).toBe('compile_error')
    expect(frame.value?.pid).toBe(process.pid)

    // The next compile clears the error, and the stream says ready and ends
    // later as any other does.
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready', port: 8080}))
    stream.ready()
    stream.interrupted('SIGINT')
    expect(parseFrames(lines).map((entry) => entry.status)).toEqual([
      'ready-failed',
      'ready',
      'stopped'
    ])

    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('reads a locked profile as E_PROFILE_LOCKED while the session runs and at exit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'profile_locked',
        message: 'the browser profile is already in use by another session',
        profileLockedAt: '2026-10-03T00:00:00.000Z'
      })
    )

    try {
      const running = makeStream({readyPath})
      running.stream.ready()
      const [frame] = parseFrames(running.lines)
      expect(frame.status).toBe('ready-failed')
      expect(frame.error?.code).toBe('E_PROFILE_LOCKED')
      expect(frame.value?.readyCode).toBe('profile_locked')

      const ending = makeStream({readyPath})
      ending.stream.starting({requestedPort: 8080, port: 8080})
      ending.stream.exited(1)
      const [, last] = parseFrames(ending.lines)
      expect(last.status).toBe('failed')
      expect(last.error?.code).toBe('E_PROFILE_LOCKED')
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  // start, preview, doctor and the act verbs name a refused load this way.
  it('reports a load the browser refused with its own status and code, and the session goes on', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    const refused = JSON.stringify({
      status: 'error',
      code: 'extension_load_refused',
      message: 'Chrome refused to load the extension at /proj/dist/chrome'
    })
    fs.writeFileSync(readyPath, refused)

    const compiler = fakeCompiler()
    const {stream, lines} = makeStream({readyPath})
    attachLifecycleStream(compiler, stream)
    compiler.taps.done(fakeStats({assets: 1}))
    stream.ready()
    expect(lines).toHaveLength(2)
    const frame = parseFrames(lines)[1]
    expect(frame.status).toBe('load-refused')
    expect(frame.ok).toBe(false)
    expect(frame.error?.code).toBe('E_EXTENSION_LOAD_REFUSED')
    expect(frame.error?.message).toBe(
      'Chrome refused to load the extension at /proj/dist/chrome'
    )

    // The session is alive, so the hint must not send the reader to a rerun
    // that would be refused as a second session.
    expect((frame as {hint?: string}).hint).toBe(
      'The session keeps running. Fix what the browser names and save: the next compile offers the extension again.'
    )

    expect(frame.value?.readyCode).toBe('extension_load_refused')

    // A compile that leaves it refused says so once, the one the browser
    // takes says ready, and a refusal after that is a verdict of its own.
    compiler.taps.done(fakeStats({assets: 1}))
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready', port: 8080}))
    compiler.taps.done(fakeStats({assets: 1}))
    compiler.taps.done(fakeStats({assets: 1}))
    fs.writeFileSync(readyPath, refused)
    compiler.taps.done(fakeStats({assets: 1}))
    stream.interrupted('SIGINT')

    expect(parseFrames(lines).map((entry) => entry.status)).toEqual([
      'compiled',
      'load-refused',
      'recompiled',
      'recompiled',
      'ready',
      'recompiled',
      'recompiled',
      'load-refused',
      'stopped'
    ])

    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('ends with one failed frame that carries the refusal when the process exits on it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'extension_load_refused',
        message: 'Chrome refused to load the extension'
      })
    )

    const {stream, lines} = makeStream({readyPath})
    stream.starting({requestedPort: 8080, port: 8080})
    stream.ready()
    stream.exited(1)
    stream.exited(1)

    const frames = parseFrames(lines)
    expect(frames.map((entry) => entry.status)).toEqual([
      'starting',
      'load-refused',
      'failed'
    ])

    expect(frames[2].error?.code).toBe('E_EXTENSION_LOAD_REFUSED')
    expect(frames[2].value?.readyCode).toBe('extension_load_refused')
    expect((frames[2] as {hint?: string}).hint).toBe(
      'Fix what the browser names, then run the command again.'
    )

    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('ends the stream with a failed frame when the process exits on a launch that failed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'browser_launch_failed',
        message:
          'the stand-in-binary process could not start, nothing is running',
        browserLaunchFailedReason: 'stand-in-binary is not here'
      })
    )

    const {stream, lines} = makeStream({readyPath})
    stream.starting({requestedPort: 8080, port: 8080})
    stream.exited(1)
    stream.exited(1)
    expect(lines).toHaveLength(2)
    const [, frame] = parseFrames(lines)
    expect(frame.status).toBe('failed')
    expect(frame.ok).toBe(false)
    expect(frame.error?.code).toBe('E_BROWSER_LAUNCH')
    expect(frame.error?.message).toBe(
      'the stand-in-binary process could not start, nothing is running'
    )

    expect(frame.value?.readyCode).toBe('browser_launch_failed')
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('carries the code the launcher stamped on the contract at exit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'browser_launch_failed',
        message: 'stand-in-binary was never installed',
        browserLaunchFailedCode: 'E_BROWSER_NOT_FOUND'
      })
    )

    const {stream, lines} = makeStream({readyPath})
    stream.starting({requestedPort: 8080, port: 8080})
    stream.exited(1)
    const [, frame] = parseFrames(lines)
    expect(frame.status).toBe('failed')
    expect(frame.error?.code).toBe('E_BROWSER_NOT_FOUND')
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('names a crash after a contract error that cleared by its exit code, not the old error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')

    try {
      const {stream, lines} = makeStream({readyPath})
      stream.starting({requestedPort: 8080, port: 8080})
      fs.writeFileSync(
        readyPath,
        JSON.stringify({status: 'error', code: 'compile_error', message: 'm'})
      )

      stream.ready()
      fs.writeFileSync(readyPath, JSON.stringify({status: 'ready', port: 8080}))
      stream.ready()
      stream.exited(1)

      const frames = parseFrames(lines)
      expect(frames.map((frame) => frame.status)).toEqual([
        'starting',
        'ready-failed',
        'ready',
        'failed'
      ])

      expect(frames[3].error?.code).toBe('E_INTERNAL')
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('names the exit code when the process ends with no contract verdict', () => {
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8080})
    stream.exited(7)
    const [, frame] = parseFrames(lines)
    expect(frame.status).toBe('failed')
    expect(frame.error?.code).toBe('E_INTERNAL')
    expect(frame.error?.message).toBe('The dev session ended with exit code 7.')
    expect(frame.value?.exitCode).toBe(7)
  })

  it('ends a session that exits clean with one ok stopped frame', () => {
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8080})
    stream.exited(0)
    stream.exited(0)
    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual(['starting', 'stopped'])
    expect(frames[1].ok).toBe(true)
    expect(frames[1].value).toMatchObject({
      pid: process.pid,
      port: 8080,
      exitCode: 0
    })
  })

  it.each([
    [
      'the browser exits and a signal follows',
      ['browser-exited', 'stopped'],
      (stream: ReturnType<typeof makeStream>['stream']) => {
        stream.browserExited({exitCode: 9})
        stream.interrupted('SIGINT')
      }
    ],
    [
      'the contract reports a launch that failed and a signal follows',
      ['ready-failed', 'stopped'],
      (stream: ReturnType<typeof makeStream>['stream']) => {
        stream.ready()
        stream.interrupted('SIGINT')
      }
    ],
    [
      'a signal arrives and the first compile lands after it',
      ['stopped'],
      (stream: ReturnType<typeof makeStream>['stream']) => {
        const compiler = fakeCompiler()
        attachLifecycleStream(compiler, stream)
        stream.interrupted('SIGINT')
        compiler.taps.done(fakeStats({}))
        compiler.taps.done(fakeStats({errors: true}))
        stream.restartFailed({code: CODES.E_CONFIG_LOAD, message: 'late'})
      }
    ],
    [
      'the server never binds and the browser exit is read after',
      ['failed'],
      (stream: ReturnType<typeof makeStream>['stream']) => {
        stream.failed('listen EADDRINUSE')
        stream.browserExited({exitCode: 9})
        stream.interrupted('SIGTERM')
      }
    ]
  ])('writes one terminal frame and nothing after it when %s', (_name, statuses, drive) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-lifecycle-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify(
        _name.startsWith('the contract')
          ? {
              status: 'error',
              code: 'browser_launch_failed',
              browserLaunchFailedCode: 'E_BROWSER_NOT_FOUND',
              message: 'no browser'
            }
          : {status: 'ready', port: 8080}
      )
    )

    try {
      const {stream, lines} = makeStream({readyPath})
      stream.starting({requestedPort: 8080, port: 8080})
      drive(stream)
      stream.exited(0)
      stream.exited(1)

      expect(parseFrames(lines).map((frame) => frame.status)).toEqual([
        'starting',
        ...statuses
      ])
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('names a stop that passed its bound, and the exit adds nothing', () => {
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8080})
    stream.shutdownTimedOut(10000, 1)
    stream.exited(1)
    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual(['starting', 'failed'])
    expect(frames[1].error).toEqual({
      code: 'E_SHUTDOWN_TIMEOUT',
      message:
        'The dev session did not stop within 10000 ms, so the process exits with code 1.'
    })

    expect(frames[1].value).toMatchObject({
      exitCode: 1,
      shutdownTimeoutMs: 10000
    })
  })

  it('keeps the stopped frame of a signal when its stop then passes the bound', () => {
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8080})
    stream.interrupted('SIGINT')
    stream.shutdownTimedOut(10000, 1)
    stream.exited(1)
    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual(['starting', 'stopped'])
    expect(frames[1].error?.code).toBe('E_INTERRUPTED')
  })

  it('leaves a stop that passed its bound before the starting frame to the command', () => {
    const {stream, lines} = makeStream()
    expect(stream.shutdownTimedOut(10000, 1)).toBeNull()
    expect(lines).toEqual([])
  })

  it('adds no failed frame at exit after an interrupt', () => {
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8080})
    stream.interrupted('SIGINT')
    stream.exited(130)
    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual(['starting', 'stopped'])
    expect(frames[1].error?.code).toBe('E_INTERRUPTED')
  })

  it('adds no second terminal frame at exit after a failed one', () => {
    const failed = makeStream()
    failed.stream.starting({requestedPort: 8080, port: 8080})
    failed.stream.failed('listen EADDRINUSE')
    failed.stream.exited(1)
    expect(failed.lines).toHaveLength(2)
  })

  it('still owes the terminal frame at exit after a browser exit, which ends nothing', () => {
    const exited = makeStream()
    exited.stream.starting({requestedPort: 8080, port: 8080})
    exited.stream.browserExited({exitCode: 9})
    exited.stream.compiled({assets: 1})
    exited.stream.exited(1)
    exited.stream.exited(1)

    const frames = parseFrames(exited.lines)
    expect(frames.map((frame) => frame.status)).toEqual([
      'starting',
      'browser-exited',
      'compiled',
      'failed'
    ])

    expect((frames[1] as {hint?: string}).hint).toBe(
      'The dev server keeps running with no browser. Stop it, then run the command again to launch one.'
    )
  })

  it('leaves a failure before the starting frame to the command layer', () => {
    const {stream, lines} = makeStream()
    stream.exited(1)
    expect(lines).toHaveLength(0)
  })

  it('writes the exit frame from the process exit event', () => {
    const listeners: Array<(code: number) => void> = []
    const once = vi.spyOn(process, 'once').mockImplementation(((
      event: string,
      listener: (code: number) => void
    ) => {
      if (event === 'exit') listeners.push(listener)

      return process
    }) as typeof process.once)
    const {stream, lines} = makeStream()
    const stop = stream.emitOnExit()
    stream.starting({requestedPort: 8080, port: 8080})
    expect(listeners).toHaveLength(1)
    listeners[0](1)
    expect(parseFrames(lines)[1].error?.code).toBe('E_INTERNAL')
    stop()
    once.mockRestore()
  })

  it('emits browser-exited as E_BROWSER_LAUNCH when nothing says otherwise', () => {
    const {stream, lines} = makeStream()
    stream.browserExited({exitCode: 9})
    stream.browserExited({exitCode: 9})
    expect(lines).toHaveLength(1)
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('browser-exited')
    expect(frame.ok).toBe(false)
    expect(frame.error?.code).toBe('E_BROWSER_LAUNCH')
    expect(frame.value?.exitCode).toBe(9)
  })

  it.each([
    [
      'the ready report',
      (stream: ReturnType<typeof makeStream>['stream']) => stream.ready()
    ],
    [
      'the exit watcher',
      (stream: ReturnType<typeof makeStream>['stream']) =>
        stream.browserExited()
    ]
  ])('writes the same browser-exited frame, once, when %s reads the exit first', (_name, notice) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-lifecycle-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'browser_exited',
        message: 'the chromium process exited with code 0, nothing is running',
        browserExitedAt: '2026-10-03T00:00:00.000Z',
        browserExitCode: 0
      })
    )

    try {
      const {stream, lines} = makeStream({readyPath})
      stream.starting({requestedPort: 8080, port: 8080})
      notice(stream)
      stream.ready()
      stream.browserExited()
      // The server keeps compiling with no browser until it is stopped.
      stream.compiled({assets: 1})
      stream.ready()
      stream.interrupted('SIGINT')

      const frames = parseFrames(lines)
      expect(frames.map((frame) => frame.status)).toEqual([
        'starting',
        'browser-exited',
        'compiled',
        'stopped'
      ])

      expect(frames[1].error?.code).toBe('E_BROWSER_LAUNCH')
      expect(frames[1].value).toMatchObject({
        readyCode: 'browser_exited',
        exitCode: 0,
        browserExitedAt: '2026-10-03T00:00:00.000Z'
      })
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('ends with one failed frame coded as the browser exit when the process exits on it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-lifecycle-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'browser_exited',
        message: 'the chromium process exited with code 0, nothing is running',
        browserExitedAt: '2026-10-03T00:00:00.000Z'
      })
    )

    try {
      const {stream, lines} = makeStream({readyPath})
      stream.starting({requestedPort: 8080, port: 8080})
      stream.exited(1)
      stream.browserExited()

      const frames = parseFrames(lines)
      expect(frames.map((frame) => frame.status)).toEqual([
        'starting',
        'failed'
      ])

      expect(frames[1].error?.code).toBe('E_BROWSER_LAUNCH')
      expect(frames[1].value?.readyCode).toBe('browser_exited')
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('upgrades browser-exited to E_PROFILE_LOCKED when the contract says so', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'profile_locked',
        message: 'the browser profile is in use',
        browserExitedAt: '2026-07-27T00:00:00.000Z'
      })
    )

    const {stream, lines} = makeStream({readyPath})
    stream.browserExited()
    const [frame] = parseFrames(lines)
    expect(frame.error?.code).toBe('E_PROFILE_LOCKED')
    expect(frame.value?.browserExitedAt).toBe('2026-07-27T00:00:00.000Z')
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('puts the remedy for a locked profile ahead of the session line on the frames that end nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    const remedy =
      'Close the browser that has this profile open, or pass --profile <path> to use another one.'
    const hintFor = (code: string) =>
      code === 'E_PROFILE_LOCKED' ? remedy : undefined
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'profile_locked',
        message: 'the browser profile is in use',
        browserExitedAt: '2026-07-27T00:00:00.000Z'
      })
    )

    try {
      const exited = makeStream({readyPath, hintFor})
      exited.stream.browserExited()
      expect((parseFrames(exited.lines)[0] as {hint?: string}).hint).toBe(
        `${remedy} The dev server keeps running with no browser. Stop it, then run the command again to launch one.`
      )

      fs.writeFileSync(
        readyPath,
        JSON.stringify({
          status: 'error',
          code: 'profile_locked',
          message: 'the browser profile is in use'
        })
      )

      const running = makeStream({readyPath, hintFor})
      running.stream.ready()
      const [frame] = parseFrames(running.lines) as Array<
        Frame & {hint?: string}
      >
      expect(frame.status).toBe('ready-failed')
      expect(frame.hint).toBe(
        `${remedy} The session keeps running. A later compile that clears the error writes the ready frame.`
      )

      // A code the host has no remedy for keeps the session line alone.
      const plain = makeStream({hintFor})
      plain.stream.browserExited({exitCode: 9})
      expect((parseFrames(plain.lines)[0] as {hint?: string}).hint).toBe(
        'The dev server keeps running with no browser. Stop it, then run the command again to launch one.'
      )
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('falls back to E_BROWSER_LAUNCH when the contract is missing or corrupt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(readyPath, '{not json')
    const {stream, lines} = makeStream({readyPath})
    stream.browserExited()
    const [frame] = parseFrames(lines)
    expect(frame.error?.code).toBe('E_BROWSER_LAUNCH')

    const missing = makeStream({readyPath: path.join(dir, 'absent.json')})
    missing.stream.browserExited()
    expect(parseFrames(missing.lines)[0].error?.code).toBe('E_BROWSER_LAUNCH')
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('adds the hint the host has for a code to a terminal frame that has none', () => {
    const asked: string[] = []

    const hintFor = (code: string) => {
      asked.push(code)

      return code === 'E_INTERNAL' ? undefined : `host hint for ${code}`
    }

    const failed = makeStream({hintFor})
    failed.stream.restartFailed({code: CODES.E_CONFIG_LOAD, message: 'kept'})
    failed.stream.browserExited({exitCode: 9})
    failed.stream.failed('listen EADDRINUSE')
    const frames = parseFrames(failed.lines) as Array<{hint?: string}>

    // Frames that end nothing keep the hints the engine gave them.
    expect(frames[0].hint).toContain('The previous build keeps serving')
    expect(frames[1].hint).toContain('The dev server keeps running')
    expect(frames[2].hint).toBe('host hint for E_DEV_SERVER_START')
    expect(asked).toEqual(['E_BROWSER_LAUNCH', 'E_DEV_SERVER_START'])

    // A code the host has nothing for leaves the frame as it was.
    const bare = makeStream({hintFor})
    bare.stream.starting({requestedPort: 8080, port: 8080})
    bare.stream.exited(1)
    expect(parseFrames(bare.lines)[1].error?.code).toBe('E_INTERNAL')
    expect('hint' in parseFrames(bare.lines)[1]).toBe(false)

    // With no resolver nothing is added.
    const none = makeStream()
    none.stream.failed('listen EADDRINUSE')
    expect('hint' in parseFrames(none.lines)[0]).toBe(false)
  })

  it('keeps the hint a terminal frame already carries, and adds one to a usage frame', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-lifecycle-'))
    const readyPath = path.join(dir, 'ready.json')
    const hintFor = (code: string) => `host hint for ${code}`

    try {
      fs.writeFileSync(
        readyPath,
        JSON.stringify({
          status: 'error',
          code: 'extension_load_refused',
          message: 'refused'
        })
      )

      const refused = makeStream({readyPath, hintFor})
      refused.stream.starting({requestedPort: 8080, port: 8080})
      refused.stream.exited(1)
      expect((parseFrames(refused.lines)[1] as {hint?: string}).hint).toBe(
        'Fix what the browser names, then run the command again.'
      )

      fs.writeFileSync(
        readyPath,
        JSON.stringify({
          status: 'error',
          code: 'browser_launch_failed',
          browserLaunchFailedCode: 'E_BROWSER_BINARY_INVALID',
          message: 'bad pin'
        })
      )

      const usage = makeStream({readyPath, hintFor})
      usage.stream.starting({requestedPort: 8080, port: 8080})
      usage.stream.exited(1)
      const [, frame] = parseFrames(usage.lines) as Array<{
        status: string
        hint?: string
      }>
      expect(frame.status).toBe('usage')
      expect(frame.hint).toBe('host hint for E_BROWSER_BINARY_INVALID')
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('writes the terminal frame with no hint when the resolver throws', () => {
    const {stream, lines} = makeStream({
      hintFor: () => {
        throw new Error('the resolver broke')
      }
    })
    stream.failed('listen EADDRINUSE')

    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('failed')
    expect(frame.error?.code).toBe('E_DEV_SERVER_START')
    expect('hint' in frame).toBe(false)
    expect(stream.ended).toBe(true)
  })

  it('still owes the terminal frame after a write of it threw', () => {
    const lines: string[] = []
    let refuse = true
    const stream = createLifecycleStream({
      command: 'dev',
      browser: 'chromium',
      distPath: '/proj/dist/chromium',
      write: (line) => {
        if (refuse && line.includes('"failed"')) {
          refuse = false

          throw new Error('EPIPE')
        }

        lines.push(line)
      }
    })

    stream.starting({requestedPort: 8080, port: 8080})
    expect(stream.failed('listen EADDRINUSE')).toBeNull()
    expect(stream.ended).toBe(false)

    stream.exited(1)
    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual(['starting', 'failed'])
    expect(stream.ended).toBe(true)
  })

  it('emits a failed frame when the dev server never binds', () => {
    const {stream, lines} = makeStream()
    stream.failed('listen EADDRINUSE')
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('failed')
    expect(frame.ok).toBe(false)
    expect(frame.error?.code).toBe('E_DEV_SERVER_START')
    expect(frame.error?.message).toBe('listen EADDRINUSE')
  })

  it('reports a failed restart without ending the session', () => {
    const {stream, lines} = makeStream()
    stream.starting({requestedPort: 8080, port: 8080})
    stream.restartFailed({
      code: CODES.E_CONFIG_LOAD,
      message: '\u001b[31mextension.config.js threw\u001b[39m'
    })

    // Not terminal: a later crash still gets its own frame at exit.
    stream.exited(1)

    const frames = parseFrames(lines) as Array<Frame & {hint?: string}>
    expect(frames.map((frame) => frame.status)).toEqual([
      'starting',
      'restart-failed',
      'failed'
    ])

    expect(frames[1].ok).toBe(false)
    expect(frames[1].error).toEqual({
      code: 'E_CONFIG_LOAD',
      message: 'extension.config.js threw'
    })

    expect(frames[1].value).toMatchObject({serving: true, port: 8080})
    expect(frames[1].hint).toContain('The previous build keeps serving.')
  })

  it('ends an interrupted session with one stopped frame coded E_INTERRUPTED', () => {
    const {stream, lines} = makeStream()
    stream.interrupted('SIGINT')
    stream.interrupted('SIGTERM')
    const frames = parseFrames(lines)
    expect(frames).toHaveLength(1)
    expect(frames[0].status).toBe('stopped')
    expect(frames[0].ok).toBe(false)
    expect(frames[0].error?.code).toBe('E_INTERRUPTED')
    expect(frames[0].error?.message).toContain('SIGINT')
    expect(frames[0].value?.signal).toBe('SIGINT')
  })

  it('drives the healthy sequence from compiler hooks', () => {
    const {stream, lines} = makeStream()
    const compiler = fakeCompiler()
    attachLifecycleStream(compiler as never, stream)
    stream.starting({requestedPort: 8080, port: 8080})
    compiler.taps.done(fakeStats({assets: 12, durationMs: 900}))
    compiler.taps.done(fakeStats({assets: 12, durationMs: 40}))
    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual([
      'starting',
      'compiled',
      'ready',
      'recompiled'
    ])

    expect(frames.every((frame) => frame.ok)).toBe(true)
    expect(frames[1].value?.assets).toBe(12)
  })

  it('writes ready again once the compiler a restart built first compiles green', () => {
    const {stream, lines} = makeStream()
    const before = fakeCompiler()
    attachLifecycleStream(before as never, stream)
    stream.starting({requestedPort: 8080, port: 8080})
    before.taps.done(fakeStats({assets: 3}))

    const after = fakeCompiler()
    attachLifecycleStream(after as never, stream, {restart: true})
    after.taps.done(fakeStats({errors: true, text: 'ERROR in ./a.js'}))
    after.taps.done(fakeStats({assets: 3}))
    after.taps.done(fakeStats({assets: 3}))
    // The retired compiler's last build says nothing about the new server.
    before.taps.done(fakeStats({assets: 3}))

    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual([
      'starting',
      'compiled',
      'ready',
      'compile-failed',
      'recompiled',
      'ready',
      'recompiled',
      'recompiled'
    ])

    expect(frames[2].value).not.toHaveProperty('restarted')
    expect(frames[5].value?.restarted).toBe(true)
  })

  it('drives the failed-first-compile sequence from compiler hooks', () => {
    const {stream, lines} = makeStream()
    const compiler = fakeCompiler()
    attachLifecycleStream(compiler as never, stream)
    stream.starting({requestedPort: 8080, port: 8080})
    compiler.taps.done(
      fakeStats({
        errors: true,
        text: 'ERROR in ./src/missing.js',
        durationMs: 3
      })
    )

    compiler.taps.done(fakeStats({assets: 4, durationMs: 20}))
    const frames = parseFrames(lines)
    expect(frames.map((frame) => frame.status)).toEqual([
      'starting',
      'compile-failed',
      'compiled',
      'ready'
    ])

    expect(frames[1].error?.code).toBe('E_FIRST_COMPILE')
    expect(frames[1].value?.output).toContain('ERROR in ./src/missing.js')
    expect(frames[1].error).not.toHaveProperty('details')
  })

  it('lists each compiler diagnostic behind a failed compile as details', () => {
    const {stream, lines} = makeStream()
    const compiler = fakeCompiler()
    attachLifecycleStream(compiler as never, stream)
    compiler.taps.done(
      fakeStats({
        errors: true,
        text: 'ERROR in ./src/missing.js',
        issues: [
          Object.assign(new Error("  × Module not found: Can't resolve"), {
            module: {resource: '/proj/src/missing.js'},
            loc: {start: {line: 3, column: 8}}
          }),
          Object.assign(new Error('bad pattern'), {
            name: 'WARInvalidMatchPattern',
            file: 'manifest.json'
          })
        ]
      })
    )

    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('compile-failed')
    expect(frame.value?.output).toContain('ERROR in ./src/missing.js')
    expect(frame.truncated).toBeUndefined()
    expect(frame.error?.details).toEqual([
      {
        code: 'E_MODULE_NOT_FOUND',
        message: "Module not found: Can't resolve",
        file: 'src/missing.js',
        line: 3,
        column: 8,
        severity: 'error'
      },
      {
        code: 'E_WAR_INVALID',
        message: 'bad pattern',
        file: 'manifest.json',
        severity: 'error',
        name: 'WARInvalidMatchPattern'
      }
    ])
  })

  it('caps the details list and says so with truncated', () => {
    const {stream, lines} = makeStream()
    const compiler = fakeCompiler()
    attachLifecycleStream(compiler as never, stream)
    compiler.taps.done(
      fakeStats({
        errors: true,
        text: 'many',
        issues: Array.from({length: 25}, (_, i) => new Error(`issue ${i}`))
      })
    )

    const [frame] = parseFrames(lines)
    expect(frame.truncated).toBe(true)
    expect(frame.error?.details).toHaveLength(20)
  })

  it('reports a fatal compiler failure as a compile-failed frame', () => {
    const {stream, lines} = makeStream()
    const compiler = fakeCompiler()
    attachLifecycleStream(compiler as never, stream)
    compiler.taps.failed(new Error('config is invalid'))
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('compile-failed')
    expect(frame.error?.code).toBe('E_FIRST_COMPILE')
    expect(frame.error?.message).toBe('config is invalid')
  })

  it('hands each failed launch to the caller once, the second one too', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-launch-'))
    const readyPath = path.join(dir, 'ready.json')
    const failedAt = (at: string) =>
      fs.writeFileSync(
        readyPath,
        JSON.stringify({
          status: 'error',
          code: 'browser_launch_failed',
          browserLaunchFailedAt: at
        })
      )
    const {stream} = makeStream({readyPath})
    const seen: unknown[] = []
    const stop = stream.watchBrowserLaunchFailure(5, (ready) =>
      seen.push(ready.browserLaunchFailedAt)
    )
    const seenCount = (count: number) =>
      vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(count), {
        timeout: 2000,
        interval: 5
      })

    try {
      failedAt('2026-10-03T00:00:00.000Z')
      await seenCount(1)
      failedAt('2026-10-03T00:00:05.000Z')
      await seenCount(2)
      expect(seen).toEqual([
        '2026-10-03T00:00:00.000Z',
        '2026-10-03T00:00:05.000Z'
      ])
    } finally {
      stop()
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('hands the exit stamp to the caller even while the stream is off', async () => {
    // The dev server tells the broker and the events file from this poll, in
    // pretty mode too, so the watcher cannot be gated on machine output.
    const saved = process.env.EXTENSION_OUTPUT
    delete process.env.EXTENSION_OUTPUT
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-exit-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))
    const {stream, lines} = makeStream({readyPath})
    const seen: Record<string, unknown>[] = []
    const stop = stream.watchBrowserExit(5, (ready) => seen.push(ready))

    try {
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(seen).toEqual([])

      fs.writeFileSync(
        readyPath,
        JSON.stringify({
          status: 'ready',
          browserExitedAt: '2026-09-25T23:24:37.253Z',
          browserExitCode: null,
          browserExitSignal: 'SIGTRAP'
        })
      )

      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({
        browserExitedAt: '2026-09-25T23:24:37.253Z',
        browserExitSignal: 'SIGTRAP'
      })

      // Off means off: the callback ran, no frame was written.
      expect(lines).toEqual([])
    } finally {
      stop()
      if (saved === undefined) delete process.env.EXTENSION_OUTPUT
      else process.env.EXTENSION_OUTPUT = saved

      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('emits browser-exited once when the contract gains the exit stamp', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))
    const {stream, lines} = makeStream({readyPath})
    const stop = stream.watchBrowserExit(5)
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(lines).toEqual([])

    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        browserExitedAt: '2026-07-27T00:00:00.000Z',
        browserExitCode: 1
      })
    )

    await new Promise((resolve) => setTimeout(resolve, 60))
    stop()
    const frames = parseFrames(lines)
    expect(frames).toHaveLength(1)
    expect(frames[0].status).toBe('browser-exited')
    expect(frames[0].error?.code).toBe('E_BROWSER_LAUNCH')
    fs.rmSync(dir, {recursive: true, force: true})
  })
})

describe('lifecycle stream warnings the run carries on past', () => {
  const original = process.env.EXTENSION_OUTPUT

  beforeEach(() => {
    process.env.EXTENSION_OUTPUT = 'ndjson'
    takeCodedWarnings()
  })

  afterEach(() => {
    if (original === undefined) delete process.env.EXTENSION_OUTPUT
    else process.env.EXTENSION_OUTPUT = original
  })

  it('carries what the setup steps recorded on the starting frame, once', () => {
    recordCodedWarning(CODES.W_POLYFILL_NOT_FOUND, 'the polyfill is missing')
    const first = makeStream()
    first.stream.starting({requestedPort: 8080, port: 8081})
    expect(parseFrames(first.lines)[0].warnings).toEqual([
      'W_PORT_IN_USE: port 8080 was taken, so the dev server listens on port 8081',
      'W_POLYFILL_NOT_FOUND: the polyfill is missing'
    ])

    const second = makeStream()
    second.stream.starting({requestedPort: 8080, port: 8080})
    expect(parseFrames(second.lines)[0].warnings).toEqual([])
  })

  it('warns with the declared code when a compile produced nothing', () => {
    const {stream, lines} = makeStream()
    stream.compiled({assets: 0, durationMs: 3, entrypoints: 0})
    stream.compiled({assets: 0, durationMs: 3})
    stream.compiled({assets: 2, durationMs: 3, entrypoints: 0})
    const frames = parseFrames(lines)
    expect(frames[0].warnings).toEqual([
      'W_NO_ENTRYPOINTS: the compilation produced no entrypoints or assets'
    ])

    expect(frames[1].warnings).toEqual([])
    expect(frames[2].warnings).toEqual([])
  })

  it('reads the entrypoint count off the stats for the compiled frame', () => {
    const {stream, lines} = makeStream()
    const compiler = fakeCompiler()
    attachLifecycleStream(compiler, stream)
    compiler.taps.done(fakeStats({assets: 0, entrypoints: 0}))
    compiler.taps.done(fakeStats({assets: 0}))
    const frames = parseFrames(lines)
    expect(frames[0].warnings).toEqual([
      'W_NO_ENTRYPOINTS: the compilation produced no entrypoints or assets'
    ])

    expect(frames[1].warnings).toEqual([])
  })

  it('says the launch is withheld on every failed compile before the first green one', () => {
    const {stream, lines} = makeStream()
    stream.compileFailed({output: 'boom'})
    stream.compileFailed({output: 'boom again'})
    stream.compiled({assets: 2, durationMs: 9})
    stream.compileFailed({output: 'boom later'})
    const frames = parseFrames(lines)
    expect(frames[0].warnings).toEqual([
      'W_LAUNCH_SKIPPED_COMPILE_ERRORS: the browser launch is withheld until the compile succeeds'
    ])

    expect(frames[1].warnings).toEqual(frames[0].warnings)
    expect(frames[3].warnings).toEqual([])
  })

  it('leaves the compile-failed frame unwarned when no browser was asked for', () => {
    const {stream, lines} = makeStream({noBrowser: true})
    stream.compileFailed({output: 'boom'})
    expect(parseFrames(lines)[0].warnings).toEqual([])
  })
})
