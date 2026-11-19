import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {ActionsFileWriter} from '../../../dev-server/control-bridge/actions-file'
import {LogsFileWriter} from '../../../dev-server/control-bridge/logs-file'
import {readControlToken} from '../../../dev-server/control-bridge/session-token'
import {startProductionControl} from '../index'

const tempFolder = trackTempFolders()

// Reserved for documentation, so no interface of this machine carries it and
// the real listen refuses it. Nothing is mocked to make the server fail.
const UNASSIGNED_HOST = '192.0.2.1'

function project() {
  const root = fs.realpathSync.native(
    tempFolder('extjs-control-server-failure-')
  )
  const distPath = path.join(root, 'dist', 'chrome')

  fs.mkdirSync(distPath, {recursive: true})
  fs.writeFileSync(
    path.join(distPath, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'x', version: '1.0.0'})
  )

  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}')

  return {root, distPath}
}

beforeEach(() => {
  // Not stand-ins: the real methods run, these only count the calls.
  vi.spyOn(LogsFileWriter.prototype, 'close')
  vi.spyOn(ActionsFileWriter.prototype, 'close')
  vi.spyOn(globalThis, 'clearInterval')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('startProductionControl when the control server cannot listen', () => {
  it('rejects with the listen error and leaves no writer, timer or token behind', async () => {
    const {root, distPath} = project()
    const exitListeners = process.listenerCount('exit')
    let thrown: (Error & {code?: string}) | undefined

    try {
      const session = await startProductionControl({
        packageJsonDir: root,
        browser: 'chrome',
        distPath,
        host: UNASSIGNED_HOST,
        allowControl: true,
        allowEval: true
      })

      await session.close()
    } catch (error) {
      thrown = error as Error & {code?: string}
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown?.code).toBe('EADDRNOTAVAIL')
    expect(LogsFileWriter.prototype.close).toHaveBeenCalledTimes(1)
    // The flush timer the log writer started is the one cleared.
    expect(clearInterval).toHaveBeenCalledTimes(1)
    expect(ActionsFileWriter.prototype.close).toHaveBeenCalledTimes(1)
    expect(readControlToken(root, 'chrome')).toBeNull()
    expect(process.listenerCount('exit')).toBe(exitListeners)
  })
})
