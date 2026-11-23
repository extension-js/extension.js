import {execFile} from 'node:child_process'
import * as path from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  skipWithoutDevelopDist,
  skipWithStaleDevelopDist
} from '../../dev-server/__spec__/helpers/develop-dist'

// Two dev sessions of one host process, started from the built library
// through the real entry: see fixtures/session-hosts.mjs.
const fixture = path.join(__dirname, 'fixtures', 'session-hosts.mjs')
const builtEntry = path.join(__dirname, '..', '..', 'dist', 'module.mjs')
const tempFolder = trackTempFolders()

interface SessionHosts {
  olderStarted: boolean
  newerStarted: boolean
  olderRestarted: boolean
  olderFirst: string | null
  newer: string | null
  olderRebuilt: string | null
  olderReadyHost: string | null
  newerReadyHost: string | null
}

function runHost(): Promise<SessionHosts> {
  const root = tempFolder('extjs-session-hosts-')

  // The host starts with no output mode, no pinned id and no host of its own.
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
    'EXTENSION_DEV_SERVER_CONNECTABLE_HOST',
    'VITEST'
  ]) {
    Reflect.deleteProperty(hostEnv, key)
  }

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [fixture, root],
      {
        env: hostEnv as NodeJS.ProcessEnv,
        timeout: 150_000,
        killSignal: 'SIGKILL',
        maxBuffer: 32 * 1024 * 1024
      },
      (error, stdout) => {
        const line = String(stdout)
          .split('\n')
          .find((entry) => entry.startsWith('RESULT '))

        if (!line) {
          reject(error ?? new Error('the host printed no result'))

          return
        }

        resolve(JSON.parse(line.slice('RESULT '.length)) as SessionHosts)
      }
    )
  })
}

beforeEach((context) => {
  skipWithoutDevelopDist(context)
  skipWithStaleDevelopDist(context, builtEntry)
})

describe('two dev sessions of one host process', () => {
  it('each bake their own connectable host, a rebuild after the other included', async () => {
    const result = await runHost()

    expect(result).toEqual({
      olderStarted: true,
      newerStarted: true,
      olderRestarted: true,
      olderFirst: 'session-a.test',
      newer: 'session-b.test',
      // Built after the newer session wrote its host to the environment.
      olderRebuilt: 'session-a.test',
      olderReadyHost: 'session-a.test',
      newerReadyHost: 'session-b.test'
    })
  }, 180_000)
})
