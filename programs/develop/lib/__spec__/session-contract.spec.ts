import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  browserArtifactsDir,
  heldReadyCanRelease,
  isDevSessionStarting,
  owedPortsSettled,
  readyContractPath,
  readyContractPathBesideBuild,
  releaseHeldReady,
  sessionArtifactsRootDir,
  sessionArtifactsRootDirBesideBuild
} from '../session-contract'
import * as sessionPaths from '../session-paths'

const project = path.resolve('/work/app')

describe('where the session contract lives', () => {
  it('names one folder per browser under the project dist', () => {
    expect(sessionArtifactsRootDir(project)).toBe(
      path.join(project, 'dist', 'extension-js')
    )

    expect(browserArtifactsDir(project, 'chrome')).toBe(
      path.join(project, 'dist', 'extension-js', 'chrome')
    )

    expect(readyContractPath(project, 'chrome')).toBe(
      path.join(project, 'dist', 'extension-js', 'chrome', 'ready.json')
    )
  })

  it('makes a relative project absolute', () => {
    expect(readyContractPath('app', 'firefox')).toBe(
      path.resolve('app', 'dist', 'extension-js', 'firefox', 'ready.json')
    )
  })

  it('finds the same file from the build folder as from the project', () => {
    for (const browser of ['chrome', 'firefox', 'chromium-based']) {
      const buildPath = sessionPaths.browserDistDir(project, browser)

      expect(readyContractPathBesideBuild(buildPath)).toBe(
        readyContractPath(project, browser)
      )

      expect(sessionArtifactsRootDirBesideBuild(buildPath)).toBe(
        sessionArtifactsRootDir(project)
      )
    }
  })

  it('follows a build folder that is not the project dist', () => {
    expect(
      readyContractPathBesideBuild(path.join(project, 'build', 'chrome'))
    ).toBe(path.join(project, 'build', 'extension-js', 'chrome', 'ready.json'))
  })

  it('gives the paths the session layout publishes', () => {
    expect(sessionPaths.sessionArtifactsRootDir(project)).toBe(
      sessionArtifactsRootDir(project)
    )

    expect(sessionPaths.browserArtifactsDir(project, 'edge')).toBe(
      browserArtifactsDir(project, 'edge')
    )

    expect(sessionPaths.readyContractPath(project, 'edge')).toBe(
      readyContractPath(project, 'edge')
    )
  })

  it('gives the paths the repository scripts derive on their own', async () => {
    const scripts = await import('../../../../scripts/lib/session-contract.mjs')

    for (const browser of ['chrome', 'firefox', 'safari']) {
      expect(scripts.sessionArtifactsDir(project, browser)).toBe(
        browserArtifactsDir(project, browser)
      )

      expect(scripts.readyContractPath(project, browser)).toBe(
        readyContractPath(project, browser)
      )
    }
  })
})

describe('when a held start turns ready', () => {
  const held = {
    command: 'dev',
    status: 'starting',
    compiledAt: '2026-11-01T00:00:00.000Z'
  }

  it('releases a compiled dev record that owes nothing', () => {
    const ready = {...held}

    expect(heldReadyCanRelease(ready)).toBe(true)
    expect(releaseHeldReady(ready)).toBe(true)
    expect(ready.status).toBe('ready')
  })

  it.each([
    ['the compile is not in', {compiledAt: null}],
    ['a code stands on the record', {code: 'profile_locked'}],
    ['the first hello is owed', {awaitingExecutorSince: held.compiledAt}],
    ['the record is not starting', {status: 'error'}],
    ['the record is already ready', {status: 'ready'}]
  ])('keeps the record as it is while %s', (_why, patch) => {
    const ready = {...held, ...patch}
    const before = {...ready}

    expect(releaseHeldReady(ready)).toBe(false)
    expect(ready).toEqual(before)
  })

  it.each([
    'start',
    'preview',
    'build'
  ])('leaves a %s record to its own launch phase', (command) => {
    const ready = {...held, command}

    expect(releaseHeldReady(ready, {launchSettled: true})).toBe(false)
    expect(ready.status).toBe('starting')
  })

  it('waits for the Firefox port, or the reason there is none', () => {
    const owed = {rdpPort: true}

    expect(heldReadyCanRelease({...held}, owed)).toBe(false)
    expect(heldReadyCanRelease({...held, rdpPort: 6006}, owed)).toBe(true)
    expect(heldReadyCanRelease({...held, rdpPortError: 'closed'}, owed)).toBe(
      true
    )

    expect(heldReadyCanRelease({...held, cdpPort: 9222}, owed)).toBe(false)
    expect(heldReadyCanRelease({...held}, {...owed, launchSettled: true})).toBe(
      false
    )
  })

  it('waits for the Chromium port, its fault, or the end of the launch', () => {
    const owed = {cdpPort: true}

    expect(heldReadyCanRelease({...held}, owed)).toBe(false)
    expect(heldReadyCanRelease({...held, cdpPort: 9222}, owed)).toBe(true)
    expect(
      heldReadyCanRelease({...held, cdpFaultCode: 'E_CDP_CONNECT'}, owed)
    ).toBe(true)

    expect(heldReadyCanRelease({...held, rdpPort: 6006}, owed)).toBe(false)
    expect(heldReadyCanRelease({...held}, {...owed, launchSettled: true})).toBe(
      true
    )
  })

  it('reads a port as settled only off the record it is given', () => {
    expect(owedPortsSettled(undefined, {})).toBe(true)
    expect(owedPortsSettled(undefined, {rdpPort: true})).toBe(false)
    expect(owedPortsSettled(undefined, {cdpPort: true})).toBe(false)
    expect(
      owedPortsSettled(undefined, {cdpPort: true, launchSettled: true})
    ).toBe(true)

    expect(owedPortsSettled({cdpPort: '9222'}, {cdpPort: true})).toBe(false)
  })

  it('calls only a dev record at starting a session that is starting', () => {
    expect(isDevSessionStarting({command: 'dev', status: 'starting'})).toBe(
      true
    )

    expect(isDevSessionStarting({command: 'start', status: 'starting'})).toBe(
      false
    )

    expect(isDevSessionStarting({command: 'dev', status: 'ready'})).toBe(false)
  })
})
