import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {quietBroker} from '../../__spec__/helpers/quiet-broker'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {recordCodedWarning, takeCodedWarnings} from '../../lib/coded-warnings'
import {CODES} from '../../lib/messaging'
import {createReadyContractWriter} from '../../plugin-ready-contract'
import {dispatchReload, type ReloadBroker} from '../../plugin-reload'
import {createLifecycleStream} from '../lifecycle-stream'
import {reportSessionWarnings} from '../session-warnings'

// The dev stream and the event log of a session, with the reload dispatch
// the session runs and a browser that takes the reload and never answers.
const tempFolder = trackTempFolders()
const LABEL = 'content_script (src/content/scripts.js)'
const EDIT = {
  type: 'content-scripts' as const,
  changedContentScriptEntries: ['content_scripts/content-0'],
  changedAssets: ['src/content/scripts.js'],
  label: LABEL
}

const stops: Array<() => void> = []

beforeEach(() => {
  vi.stubEnv('EXTENSION_OUTPUT', 'ndjson')
})

afterEach(() => {
  for (const stop of stops.splice(0)) stop()

  takeCodedWarnings()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function session(broker: ReloadBroker) {
  const root = tempFolder('extjs-session-warning-')
  const metadata = createReadyContractWriter({
    packageJsonDir: root,
    browser: 'chromium',
    command: 'dev',
    distPath: path.join(root, 'dist', 'chromium'),
    manifestPath: path.join(root, 'manifest.json'),
    port: 8080
  })
  const lines: string[] = []
  const lifecycle = createLifecycleStream({
    command: 'dev',
    browser: 'chromium',
    distPath: path.join(root, 'dist', 'chromium'),
    readyPath: metadata.readyPath,
    eventsPath: path.join(path.dirname(metadata.readyPath), 'events.ndjson'),
    noBrowser: true,
    write: (line) => lines.push(line)
  })

  metadata.writeStarting()
  lifecycle.starting({requestedPort: 8080, port: 8080})
  stops.push(reportSessionWarnings({lifecycle, metadata, broker}))

  return {
    lifecycle,
    frames: () =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    events: () =>
      fs
        .readFileSync(
          path.join(path.dirname(metadata.readyPath), 'events.ndjson'),
          'utf8'
        )
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((event) => event.type === 'warning'),
    runId: () =>
      JSON.parse(fs.readFileSync(metadata.readyPath, 'utf8')).runId as string
  }
}

const silent = () =>
  quietBroker({
    broadcastReload: () => 1,
    awaitReloadAck: () => Promise.resolve('unacked' as const)
  })

describe('a reload the extension never confirmed, in a dev session', () => {
  it('writes one warning frame the moment it is known, and no compile frame repeats it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broker = silent()
    const dev = session(broker)

    dev.lifecycle.compiled({assets: 1, durationMs: 5})
    await dispatchReload(EDIT, {broker})

    // Before any other compile.
    const [starting, compiled, warning] = dev.frames()

    expect([starting.status, compiled.status]).toEqual(['starting', 'compiled'])
    expect(warning).toMatchObject({
      schema: 1,
      ok: true,
      command: 'dev',
      status: 'warning',
      error: null,
      warnings: [
        `W_RELOAD_NOT_APPLIED: ${LABEL} compiled but the extension never confirmed the reload`
      ]
    })

    expect(warning.value).toMatchObject({
      code: 'W_RELOAD_NOT_APPLIED',
      message: `${LABEL} compiled but the extension never confirmed the reload`
    })

    // The frame is a compile frame's keys and nothing else, so a reader of
    // one reads the other, with the code and the message added to the value.
    expect(Object.keys(warning).sort()).toEqual(Object.keys(compiled).sort())
    expect(
      Object.keys(warning.value as object)
        .filter((key) => !(key in (compiled.value as object)))
        .sort()
    ).toEqual(['code', 'message'])

    dev.lifecycle.compiled({assets: 1, durationMs: 6})
    dev.lifecycle.compileFailed({output: 'broken', durationMs: 7})

    expect(dev.frames().map((frame) => [frame.status, frame.warnings])).toEqual(
      [
        ['starting', []],
        ['compiled', []],
        ['warning', [expect.stringContaining('W_RELOAD_NOT_APPLIED: ')]],
        ['recompiled', []],
        ['compile-failed', []]
      ]
    )
  })

  it('writes the same warning to the event log, once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broker = silent()
    const dev = session(broker)

    await dispatchReload(EDIT, {broker})
    dev.lifecycle.compiled({assets: 1, durationMs: 6})

    expect(dev.events()).toEqual([
      {
        type: 'warning',
        ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        command: 'dev',
        browser: 'chromium',
        code: 'W_RELOAD_NOT_APPLIED',
        reason: `${LABEL} compiled but the extension never confirmed the reload`,
        runId: dev.runId()
      }
    ])
  })

  it('says it for the extension that never came back, too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const broker = quietBroker({
      broadcastReload: () => 1,
      awaitReloadAck: () => Promise.resolve('acked' as const),
      awaitReloadRestart: () => Promise.resolve('not-restarted' as const)
    })
    const dev = session(broker)

    await dispatchReload(EDIT, {broker})
    await Promise.resolve()

    expect(
      dev
        .frames()
        .filter((frame) => frame.status === 'warning')
        .map((frame) => frame.warnings)
    ).toEqual([
      [
        `W_RELOAD_NOT_APPLIED: ${LABEL} reloaded but the extension has not come back since`
      ]
    ])
  })

  it('reports it in the session whose reload it was, and in no other', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mine = silent()
    const dev = session(mine)
    const other = session(silent())

    await dispatchReload(EDIT, {broker: mine})

    expect(dev.frames().map((frame) => frame.status)).toEqual([
      'starting',
      'warning'
    ])

    expect(other.frames().map((frame) => frame.status)).toEqual(['starting'])
    expect(other.events()).toEqual([])
  })

  it('leaves the terminal as it was and still writes the event log in text mode', async () => {
    vi.stubEnv('EXTENSION_OUTPUT', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broker = silent()
    const dev = session(broker)

    await dispatchReload(EDIT, {broker})

    expect(dev.frames()).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).not.toContain('W_RELOAD_NOT_APPLIED')
    expect(dev.events()).toHaveLength(1)
    expect(takeCodedWarnings()).toEqual([])
  })

  it('keeps nothing once the session is over', () => {
    const dev = session(silent())

    for (const stop of stops.splice(0)) stop()

    recordCodedWarning(CODES.W_RELOAD_NOT_APPLIED, 'after the session')

    expect(dev.frames().map((frame) => frame.status)).toEqual(['starting'])
    expect(takeCodedWarnings()).toEqual([
      'W_RELOAD_NOT_APPLIED: after the session'
    ])
  })
})
