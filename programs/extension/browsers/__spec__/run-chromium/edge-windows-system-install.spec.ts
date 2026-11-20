import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

const seen = {env: null as NodeJS.ProcessEnv | null}

vi.mock('edge-location', () => ({
  default: (deps?: {env?: NodeJS.ProcessEnv}) => {
    seen.env = deps?.env ?? null

    return null
  },
  getInstallGuidance: () => 'install edge (raw guidance)'
}))

import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {createChromiumContext} from '../../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../../run-chromium/chromium-launch'
import {emptyPathFolder, expectSealedBrowserEnv} from '../sealed-browser-env'

const makeTempFolder = trackTempFolders()

// Every folder is inside the temp root: on a real Windows machine the usual
// values name the folders an installed Edge lives in.
const windowsOnlyCasing = (root: string, localAppData: string) => ({
  ProgramFiles: path.join(root, 'Program Files'),
  'ProgramFiles(x86)': path.join(root, 'Program Files (x86)'),
  ProgramW6432: path.join(root, 'Program Files'),
  LOCALAPPDATA: localAppData,
  APPDATA: path.join(localAppData, '..', 'Roaming'),
  USERPROFILE: path.dirname(path.dirname(localAppData)),
  SystemRoot: path.join(root, 'Windows'),
  Path: emptyPathFolder(root),
  // This env drops the suite's own guard, and nothing found offers a download.
  EXTENSION_NO_INSTALL_PROMPT: '1',
  FORCE_COLOR: '0',
  NO_COLOR: '1'
})

describe('--browser=edge on Windows with only the system Edge installed', () => {
  const prevEnv = process.env
  const prevPlatform = process.platform
  const prevCwd = process.cwd()
  let localAppData = ''
  let root = ''

  // Fails before any launch if the stub stopped answering for the real scan.
  beforeAll(async () => {
    const edge = await import('edge-location')
    expect(edge.getInstallGuidance()).toBe('install edge (raw guidance)')
  })

  beforeEach(() => {
    root = makeTempFolder('ext-edge-win-')
    localAppData = path.join(root, 'AppData', 'Local')
    fs.mkdirSync(localAppData, {recursive: true})
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    process.chdir(root)
    seen.env = null
    process.env = windowsOnlyCasing(
      root,
      localAppData
    ) as unknown as NodeJS.ProcessEnv

    expectSealedBrowserEnv(root)

    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true
    })
  })

  afterEach(() => {
    process.env = prevEnv
    Object.defineProperty(process, 'platform', {
      value: prevPlatform,
      configurable: true
    })

    process.chdir(prevCwd)
  })

  it('hands the locator an env that answers the upper-case Windows names', async () => {
    const plugin = new ChromiumLaunchPlugin(
      {browser: 'edge', extension: ['/ext'], dryRun: true} as any,
      createChromiumContext() as any
    )
    const outputPath = path.join(path.dirname(localAppData), 'dist', 'edge')
    const compilation = {
      options: {output: {path: outputPath}, mode: 'development'},
      outputOptions: {path: outputPath}
    }

    await expect(
      (plugin as any).launchChromium(compilation)
    ).rejects.toMatchObject({
      code: 'E_BROWSER_NOT_FOUND',
      message: expect.stringContaining(
        "edge isn't installed and no binary was found"
      )
    })

    expect(seen.env).not.toBeNull()

    const env = seen.env as NodeJS.ProcessEnv
    expect(env.PROGRAMFILES).toBe(path.join(root, 'Program Files'))
    expect(env['PROGRAMFILES(X86)']).toBe(
      path.join(root, 'Program Files (x86)')
    )

    expect(env.LOCALAPPDATA).toBe(localAppData)
    // The cache root is joined by the Windows rules this run claims, on a
    // POSIX host too. LOCALAPPDATA stays a temp path so the env stays sealed.
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe(
      path.join(
        path.win32.join(localAppData, 'extension.js', 'browsers'),
        'edge'
      )
    )

    expect(env.EDGE_BINARY).toBeUndefined()
  })
})
