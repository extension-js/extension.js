import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {PortManager} from '../port-manager'

// The repro: the persisted port is taken AND the ephemeral fallback cannot
// bind either, so the session comes up with no control port at all.
const {startControlServer} = vi.hoisted(() => ({
  startControlServer: vi.fn(async (options: {port?: number}) => {
    throw new Error(
      options.port
        ? 'listen EADDRINUSE 127.0.0.1:50111'
        : 'listen EADDRNOTAVAIL 10.0.0.9:0'
    )
  })
}))

vi.mock('@rspack/core', () => ({
  rspack: vi.fn(() => ({}))
}))

vi.mock('@rspack/dev-server', () => ({
  RspackDevServer: class MockRspackDevServer {
    start = vi.fn(async () => {})
  }
}))

vi.mock('../control-bridge/ws-control-server', () => ({
  startControlServer
}))

vi.mock('../frameworks', () => ({
  isUsingJSFramework: vi.fn(() => false)
}))

vi.mock('../../lib/config-loader', () => ({
  loadCommandConfig: vi.fn(async () => ({})),
  loadBrowserConfig: vi.fn(async () => ({})),
  loadCustomConfig: vi.fn(async () => (config: unknown) => config),
  loadConfigResolvedHook: vi.fn(async () => undefined),
  loadProjectConfigDefaults: vi.fn(async () => ({}))
}))

vi.mock(
  '../../plugin-special-folders/folder-extensions/resolve-config',
  () => ({
    resolveCompanionExtensionsConfig: vi.fn(async () => undefined)
  })
)

vi.mock('../../plugin-special-folders/get-data', () => ({
  getSpecialFoldersDataForProjectRoot: vi.fn(() => ({extensions: undefined})),
  rememberSpecialFoldersConfig: vi.fn()
}))

vi.mock('../../lib/sanitize', () => ({
  sanitize: (value: unknown) => value
}))

vi.mock('../compiler-hooks', () => ({
  setupCompilerLifecycleHooks: vi.fn(),
  setupNoBrowserBannerOnFirstDone: vi.fn()
}))

vi.mock('../cleanup', () => ({
  setupCleanupHandlers: vi.fn()
}))

vi.mock('../../plugin-playwright', () => ({
  createPlaywrightMetadataWriter: vi.fn(() => ({})),
  getSessionRunId: vi.fn(() => 'run-test')
}))

vi.mock('../../rspack-config', () => ({
  default: vi.fn(() => ({plugins: [], devServer: {}}))
}))

vi.mock('../port-manager', () => ({
  PortManager: class MockPortManager {
    allocatePorts = vi.fn(async () => ({port: 8080}))
    getCurrentInstance = vi.fn(() => ({instanceId: 'instance-1'}))
    releaseReservedPort = vi.fn(async () => {})
    terminateCurrentInstance = vi.fn(async () => {})
  }
}))

import {devServer} from '../index'
import {PortManager as PortManagerMock} from '../port-manager'

describe('dev-server control-bridge startup failure', () => {
  let projectRoot: string
  let logged: string[]

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-bridge-'))
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}', 'utf-8')
    // A persisted port is what makes the session try the ephemeral fallback.
    fs.mkdirSync(path.join(projectRoot, '.extension-js'), {recursive: true})
    fs.writeFileSync(
      path.join(projectRoot, '.extension-js', 'control-port-chrome'),
      '50111\n',
      'utf-8'
    )

    logged = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })

    startControlServer.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(projectRoot, {recursive: true, force: true})
  })

  it('reports a control port that cannot bind instead of swallowing it', async () => {
    await devServer(
      {
        manifestPath: path.join(projectRoot, 'manifest.json'),
        packageJsonPath: path.join(projectRoot, 'package.json')
      },
      {browser: 'chrome', noBrowser: true} as any
    )

    // Both the preferred-port call and the ephemeral fallback must have run.
    expect(startControlServer).toHaveBeenCalledTimes(2)
    expect(startControlServer.mock.calls[0]?.[0]).toMatchObject({port: 50111})
    expect(startControlServer.mock.calls[1]?.[0]?.port).toBeUndefined()

    const output = logged.join('\n')
    expect(output).toContain("couldn't open the control port")
    expect(output).toContain('listen EADDRNOTAVAIL 10.0.0.9:0')
    expect(output).toContain('nothing reloads in the browser')
  })

  // Specs are excluded from tsc, so a mock that falls behind the real class is
  // only caught here. Dropping one method cost a whole CI run to diagnose.
  it('mocks every method the real port manager exposes', async () => {
    const actual =
      await vi.importActual<typeof import('../port-manager')>('../port-manager')
    const real = Object.getOwnPropertyNames(
      actual.PortManager.prototype
    ).filter((name) => name !== 'constructor')
    const mocked = Object.getOwnPropertyNames(
      new (PortManagerMock as unknown as new () => PortManager)()
    )

    expect(real.length).toBeGreaterThan(0)
    expect(real.filter((name) => !mocked.includes(name))).toEqual([])
  })
})
