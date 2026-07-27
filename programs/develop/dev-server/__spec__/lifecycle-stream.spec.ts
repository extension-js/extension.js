import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  attachLifecycleStream,
  createLifecycleStream,
  humanLine,
  isLifecycleStreamEnabled,
  isMachineOutput
} from '../lifecycle-stream'

type Frame = {
  schema: number
  ok: boolean
  command: string
  status: string
  value: Record<string, unknown> | null
  error: {code: string; message: string} | null
  warnings: string[]
  truncated?: boolean
}

function makeStream(options: {readyPath?: string} = {}) {
  const lines: string[] = []
  const stream = createLifecycleStream({
    command: 'dev',
    browser: 'chromium',
    distPath: '/proj/dist/chromium',
    readyPath: options.readyPath,
    eventsPath: '/proj/.extension-js/chromium/events.ndjson',
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
  durationMs?: number
  text?: string
}) {
  const assets = Array.from({length: options.assets ?? 0}, (_, i) => ({
    name: `asset-${i}.js`
  }))
  return {
    hasErrors: () => Boolean(options.errors),
    toString: () => options.text ?? '',
    compilation: {
      startTime: 0,
      endTime: options.durationMs ?? 0,
      getAssets: () => assets
    }
  }
}

function fakeCompiler() {
  const taps: Record<string, (arg: any) => void> = {}
  return {
    taps,
    hooks: {
      done: {
        tap: (_name: string, fn: (stats: any) => void) => {
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

  it('emits exactly one compiled frame with assets and duration', () => {
    const {stream, lines} = makeStream()
    stream.compiled({assets: 7, durationMs: 421})
    expect(lines).toHaveLength(1)
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('compiled')
    expect(frame.value?.assets).toBe(7)
    expect(frame.value?.durationMs).toBe(421)
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

  it('fails the ready frame when the contract still reports an error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ndjson-'))
    const readyPath = path.join(dir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'error',
        code: 'extension_load_refused',
        message: 'the browser refused to load the extension'
      })
    )
    const {stream, lines} = makeStream({readyPath})
    stream.ready()
    stream.ready()
    expect(lines).toHaveLength(1)
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('failed')
    expect(frame.ok).toBe(false)
    expect(frame.error?.code).toBe('E_READY_ERROR_STATUS')
    expect(frame.value?.readyCode).toBe('extension_load_refused')
    fs.rmSync(dir, {recursive: true, force: true})
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

  it('emits a failed frame when the dev server never binds', () => {
    const {stream, lines} = makeStream()
    stream.failed('listen EADDRINUSE')
    const [frame] = parseFrames(lines)
    expect(frame.status).toBe('failed')
    expect(frame.ok).toBe(false)
    expect(frame.error?.code).toBe('E_INTERNAL')
    expect(frame.error?.message).toBe('listen EADDRINUSE')
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
