import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {codedError} from '../../lib/coded-error'
import {CODES} from '../../lib/messaging'
import {createPlaywrightMetadataWriter} from '../../plugin-playwright'
import {createRestartFailure} from '../start-bundler'

// A dev restart that fails writes a frame to the stream. The events file is
// the same timeline on disk, read by whoever did not hold the stream.
const tempFolder = trackTempFolders()

function session(exitOnError = true) {
  const root = tempFolder('extjs-restart-failed-')
  const metadata = createPlaywrightMetadataWriter({
    packageJsonDir: root,
    browser: 'chromium',
    command: 'dev',
    distPath: path.join(root, 'dist', 'chromium'),
    manifestPath: path.join(root, 'manifest.json'),
    port: 8080
  })

  metadata.writeStarting()

  const failure = createRestartFailure({
    metadata,
    lifecycle: {failed: () => {}, restartFailed: () => {}},
    keepServing: () => {},
    hasQueuedRestart: () => false,
    release: async () => {},
    print: () => {},
    exit: () => {},
    exitOnError
  })
  const events = () =>
    fs
      .readFileSync(
        path.join(root, 'dist', 'extension-js', 'chromium', 'events.ndjson'),
        'utf8'
      )
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.type === 'restart_failed')
  const runId = () =>
    JSON.parse(fs.readFileSync(metadata.readyPath, 'utf8')).runId as string

  return {failure, events, runId}
}

describe('events.ndjson after a dev restart that failed', () => {
  it('names the code and reason while the previous build keeps serving', () => {
    const {failure, events, runId} = session()

    failure.bundle(
      codedError(CODES.E_CONFIG_LOAD, 'extension.config.js: Unexpected token')
    )

    expect(events()).toEqual([
      {
        type: 'restart_failed',
        ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        command: 'dev',
        browser: 'chromium',
        code: 'E_CONFIG_LOAD',
        reason: 'extension.config.js: Unexpected token',
        serving: true,
        runId: runId()
      }
    ])
  })

  it('says no build serves when the next server could not start', async () => {
    const {failure, events} = session(false)

    await failure.start(new Error('listen EADDRINUSE'), {})

    expect(events()).toMatchObject([
      {
        type: 'restart_failed',
        code: 'E_DEV_SERVER_START',
        reason: 'listen EADDRINUSE',
        serving: false
      }
    ])
  })
})
