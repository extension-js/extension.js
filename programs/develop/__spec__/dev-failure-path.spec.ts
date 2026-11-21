import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {extensionDev} from '../command-dev'
import {trackTempFolders} from './helpers/temp-folders'

// What a dev session does when it cannot start, on real folders: one path
// for every failure, whether the caller exits on it or holds the rejection.
const tempFolder = trackTempFolders()

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function project(files: Record<string, string>) {
  const root = fs.realpathSync(tempFolder('extjs-dev-failure-'))

  for (const [file, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, file), text)
  }

  return root
}

const packageJson = JSON.stringify({
  private: true,
  name: 'dev-failure',
  version: '0.0.0'
})

function exitingRun() {
  // Nightly jobs export author mode, which prints the error object instead.
  vi.stubEnv('EXTENSION_AUTHOR_MODE', 'false')

  const printed: string[] = []

  vi.spyOn(console, 'error').mockImplementation((...parts) => {
    printed.push(parts.map(String).join(' '))
  })

  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit 1')
  })

  return {printed, exit, onExitError: vi.fn()}
}

describe('a dev session that cannot start', () => {
  it('reports a missing manifest through the exit path like any other failure', async () => {
    const root = project({'package.json': packageJson})
    const {printed, exit, onExitError} = exitingRun()

    await expect(
      extensionDev(root, {
        browser: 'chromium',
        install: false,
        exitOnError: true,
        onExitError
      })
    ).rejects.toThrow('exit 1')

    expect(exit).toHaveBeenCalledWith(1)
    expect(onExitError).toHaveBeenCalledTimes(1)
    expect(onExitError.mock.calls[0][0]).toMatchObject({
      code: 'E_MANIFEST_NOT_FOUND'
    })

    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain('Dev mode failed.')
    expect(printed[0]).toContain('Manifest file not found.')
  })

  it('rejects with the coded manifest error and prints nothing for a library caller', async () => {
    const root = project({'package.json': packageJson})
    const {printed, exit, onExitError} = exitingRun()

    await expect(
      extensionDev(root, {
        browser: 'chromium',
        install: false,
        onExitError
      })
    ).rejects.toMatchObject({code: 'E_MANIFEST_NOT_FOUND'})

    expect(exit).not.toHaveBeenCalled()
    expect(onExitError).not.toHaveBeenCalled()
    expect(printed).toEqual([])
  })
})
