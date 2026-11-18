import {execFile} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeEach, describe, expect, it} from 'vitest'
import {
  skipWithoutDevelopDist,
  skipWithStaleDevelopDist
} from './helpers/develop-dist'

// Dev sessions started from the built library in a host that goes on
// running, through the real entry: see fixtures/library-sessions.mjs.
const fixture = path.join(__dirname, 'fixtures', 'library-sessions.mjs')
const builtEntry = path.join(__dirname, '..', '..', 'dist', 'module.mjs')
const roots: string[] = []

// What the bundler's own dev server writes when it is first loaded.
const BUNDLER_ENV = ['RSPACK_SERVE']

interface FailedSession {
  started: boolean
  code?: string
  message?: string
  instanceId?: string
  runId?: string
  readyRunId?: string | null
  framed?: boolean
  envChanged: string[]
}

interface HostResult {
  before: number[]
  after: number[]
  sessions: FailedSession[]
  socketsClosed: boolean
  listening: number[]
  instanceIdLeft: string | null
  manifestWriteGoesThrough: boolean
}

interface TwoSessionsResult {
  before: number[]
  olderAlone: number[]
  live: number[]
  afterNewerEnded: number[]
  newerSettled: boolean
  envChangedByNewer: string[]
  started: Array<{started: boolean}>
  bothReady: boolean
  newerReleased: boolean
  olderRestarted: boolean
}

function runHost<Result>(scenario: string, env: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-library-host-'))
  roots.push(root)

  // The host starts with no output mode and no pinned id of its own.
  const hostEnv: Record<string, string | undefined> = {
    ...process.env,
    EXTENSION_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1'
  }

  for (const key of [
    'EXTENSION_OUTPUT',
    'EXTENSION_INSTANCE_ID',
    'EXTENSION_DEV_INSTANCE_ID',
    'EXTJS_INSTANCE_ID',
    'VITEST'
  ]) {
    Reflect.deleteProperty(hostEnv, key)
  }

  return new Promise<{result: Result; frames: Array<Record<string, any>>}>(
    (resolve, reject) => {
      execFile(
        process.execPath,
        [fixture, scenario, root],
        {
          env: {...hostEnv, ...env} as NodeJS.ProcessEnv,
          timeout: 150_000,
          killSignal: 'SIGKILL',
          maxBuffer: 32 * 1024 * 1024
        },
        (error, stdout) => {
          const lines = String(stdout).split('\n')
          const line = lines.find((entry) => entry.startsWith('RESULT '))

          if (!line) {
            reject(error ?? new Error('the host printed no result'))

            return
          }

          resolve({
            result: JSON.parse(line.slice('RESULT '.length)) as Result,
            frames: lines
              .filter((entry) => entry.startsWith('{'))
              .map((entry) => JSON.parse(entry))
          })
        }
      )
    }
  )
}

beforeEach((context) => {
  skipWithoutDevelopDist(context)
  skipWithStaleDevelopDist(context, builtEntry)
})

afterAll(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('a host that starts dev sessions from the library', () => {
  it.each([
    ['its config is refused before a compiler exists', 'config', 'config hook'],
    ['its bundle throws once the manifest is guarded', 'bundle', 'tap broke'],
    ['its server cannot start', 'start', 'watch broke']
  ])(
    'is left as it was by four sessions that fail because %s',
    async (_name, scenario, message) => {
      const {result} = await runHost<HostResult>(scenario)

      expect(result.sessions).toHaveLength(4)

      for (const session of result.sessions) {
        expect(session.started).toBe(false)
        expect(session.message).toContain(message)
      }

      // The environment reads after each session as it did before it.
      expect(
        result.sessions.map((session) =>
          session.envChanged.filter((name) => !BUNDLER_ENV.includes(name))
        )
      ).toEqual([[], [], [], []])

      expect(result.sessions.slice(1).map((s) => s.envChanged)).toEqual([
        [],
        [],
        []
      ])

      // No listener, no socket, no id in the environment, no guard on fs.
      expect(result.after).toEqual(result.before)
      expect(result.socketsClosed).toBe(true)
      expect(result.listening).toEqual([])
      expect(result.instanceIdLeft).toBeNull()
      expect(result.manifestWriteGoesThrough).toBe(true)
    },
    180_000
  )

  it('gives each session its own instance id and one failed frame that names it', async () => {
    const {result, frames} = await runHost<HostResult>('start', {
      EXTENSION_OUTPUT: 'ndjson'
    })
    const ids = result.sessions.map((session) => session.instanceId)

    expect(new Set(ids).size).toBe(4)

    for (const session of result.sessions) {
      expect(session.code).toBe('E_DEV_SERVER_START')
      expect(session.framed).toBe(true)
    }

    // Each stream: one starting frame, then the one terminal frame.
    expect(frames.map((frame) => frame.status)).toEqual(
      ids.flatMap(() => ['starting', 'failed'])
    )

    expect(
      frames
        .filter((frame) => frame.status === 'failed')
        .map((frame) => frame.value?.instanceId)
    ).toEqual(ids)

    // The host passed a hint resolver with its options, and the frame the
    // engine wrote carries what it answered for the code.
    expect(
      frames
        .filter((frame) => frame.status === 'failed')
        .map((frame) => frame.hint)
    ).toEqual(ids.map(() => 'host hint for E_DEV_SERVER_START'))

    expect(result.after).toEqual(result.before)
  }, 180_000)

  it('ends a start that failed before the starting frame with one failed frame', async () => {
    const {result, frames} = await runHost<HostResult>('config', {
      EXTENSION_OUTPUT: 'ndjson'
    })

    // Nothing but the terminal frame, once per session, and the rejection
    // says it is written.
    expect(frames.map((frame) => frame.status)).toEqual([
      'failed',
      'failed',
      'failed',
      'failed'
    ])

    for (const frame of frames) {
      expect(frame).toMatchObject({
        ok: false,
        command: 'dev',
        error: {code: 'E_INTERNAL', message: 'config hook broke'},
        hint: 'host hint for E_INTERNAL',
        value: {command: 'dev', browser: 'chromium', pid: expect.any(Number)}
      })
    }

    expect(result.sessions.map((session) => session.framed)).toEqual([
      true,
      true,
      true,
      true
    ])
  }, 180_000)

  it('gives each session in turn its own run, named by its frames and its contract', async () => {
    const {result, frames} = await runHost<HostResult>('start', {
      EXTENSION_OUTPUT: 'ndjson'
    })
    const runIds = result.sessions.map((session) => session.runId)

    expect(runIds.every((runId) => typeof runId === 'string')).toBe(true)
    expect(new Set(runIds).size).toBe(4)

    // Both frames of a session and the ready.json it left name its run.
    expect(frames.map((frame) => frame.value?.runId)).toEqual(
      runIds.flatMap((runId) => [runId, runId])
    )

    expect(result.sessions.map((session) => session.readyRunId)).toEqual(runIds)
  }, 180_000)

  it('writes one failed frame and exits 1 when the CLI host ends the session as failed', async () => {
    const {result, frames} = await runHost<{
      before: boolean
      ended: boolean
      exitCode: number | null
    }>('end-as-failed-cli', {EXTENSION_OUTPUT: 'ndjson'})

    // No session was live at the first call, and one was at the second.
    expect(result).toEqual({before: false, ended: true, exitCode: 1})

    const statuses = frames.map((frame) => frame.status)
    expect(statuses.filter((status) => status === 'failed')).toHaveLength(1)
    expect(statuses).not.toContain('stopped')
    expect(statuses[statuses.length - 1]).toBe('failed')
    expect(frames[frames.length - 1]).toMatchObject({
      ok: false,
      error: {code: 'E_PARENT_GONE', message: 'the owner is gone'},
      hint: 'host hint for E_PARENT_GONE',
      value: {pid: expect.any(Number), port: expect.any(Number)}
    })
  }, 180_000)

  it('ends one of two library sessions as failed and leaves the host and the other running', async () => {
    const {result, frames} = await runHost<{
      bothReady: boolean
      unknown: boolean
      ended: boolean
      again: boolean
      newerSettled: boolean
      olderRestarted: boolean
      olderId: string
      newerId: string
    }>('end-as-failed', {EXTENSION_OUTPUT: 'ndjson'})

    // The host printed its result and exited on its own, so it lived on.
    expect(result).toMatchObject({
      bothReady: true,
      unknown: false,
      ended: true,
      again: false,
      newerSettled: true,
      olderRestarted: true
    })

    expect(result.olderId).not.toBe(result.newerId)

    const failed = frames.filter((frame) => frame.status === 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({
      error: {code: 'E_PARENT_GONE', message: 'the owner is gone'},
      value: {instanceId: result.newerId}
    })

    // The older stream goes on past it and ends only with the host's own
    // clean exit.
    const older = frames.filter(
      (frame) => frame.value?.instanceId === result.olderId
    )
    expect(
      older
        .filter((frame) =>
          ['failed', 'usage', 'stopped'].includes(frame.status)
        )
        .map((frame) => [frame.status, frame.ok, frame.value?.exitCode])
    ).toEqual([['stopped', true, 0]])
  }, 180_000)

  it('runs one of two starts of one project in one tick and refuses the other, coded', async () => {
    const {result, frames} = await runHost<{
      results: Array<{started: boolean; code?: string; framed?: boolean}>
      firstId: string
      ended: boolean
      released: boolean
      third: {started: boolean; code?: string}
    }>('same-tick', {EXTENSION_OUTPUT: 'ndjson'})

    expect(result.results.map((entry) => entry.started).sort()).toEqual([
      false,
      true
    ])

    // The refusal is the host's to report: the stdout it would write to is
    // the running session's, and a frame there reads as that session's end.
    expect(result.results.find((entry) => !entry.started)).toEqual({
      started: false,
      code: 'E_SESSION_EXISTS',
      framed: false
    })

    expect(
      frames.every((frame) => typeof frame.value?.instanceId === 'string')
    ).toBe(true)

    expect(
      frames
        .filter((frame) => frame.value?.instanceId === result.firstId)
        .filter((frame) => frame.ok === false)
        .map((frame) => frame.error?.code)
    ).toEqual(['E_PARENT_GONE'])

    expect(JSON.stringify(frames)).not.toContain('E_SESSION_EXISTS')

    // Once the running one has ended, the project takes a new session.
    expect(result.ended).toBe(true)
    expect(result.released).toBe(true)
    expect(result.third).toEqual({started: true})
  }, 180_000)

  it('answers false and writes no frame when the host ends a session before any is live', async () => {
    const {result, frames} = await runHost<{
      ended: boolean
      before: number[]
      after: number[]
    }>('end-before-session', {EXTENSION_OUTPUT: 'ndjson'})

    expect(result.ended).toBe(false)
    expect(result.after).toEqual(result.before)
    expect(result.before).toEqual([0, 0, 0, 0, 0, 0])

    // The signal the host sends itself next finds no engine handler.
    expect(frames).toEqual([])
  }, 180_000)

  it('keeps an older session restarting after a newer one lost its server', async () => {
    const {result} = await runHost<TwoSessionsResult>('restart')

    expect(result.started).toEqual([{started: true}, {started: true}])
    expect(result.bothReady).toBe(true)

    // The newer session is released whole, and the older one keeps its own:
    // its listeners, and the environment its next compiler reads.
    expect(result.newerReleased).toBe(true)
    expect(result.newerSettled).toBe(true)
    expect(result.afterNewerEnded).toEqual(result.olderAlone)
    expect(result.live).toEqual(result.olderAlone.map((count) => count * 2))
    expect(result.envChangedByNewer).toEqual([])

    expect(result.olderRestarted).toBe(true)
  }, 180_000)
})
