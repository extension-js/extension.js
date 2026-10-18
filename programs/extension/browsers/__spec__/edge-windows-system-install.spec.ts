import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const seen = {env: null as NodeJS.ProcessEnv | null}

vi.mock('edge-location', () => ({
  default: (deps?: {env?: NodeJS.ProcessEnv}) => {
    seen.env = deps?.env ?? null

    return null
  },
  getInstallGuidance: () => 'install edge (raw guidance)'
}))

import {createChromiumContext} from '../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../run-chromium/chromium-launch'

const windowsOnlyCasing = (localAppData: string) => ({
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ProgramW6432: 'C:\\Program Files',
  LOCALAPPDATA: localAppData,
  APPDATA: path.join(localAppData, '..', 'Roaming'),
  USERPROFILE: path.dirname(path.dirname(localAppData)),
  SystemRoot: 'C:\\Windows',
  Path: 'C:\\Windows\\system32',
  FORCE_COLOR: '0',
  NO_COLOR: '1'
})

describe('--browser=edge on Windows with only the system Edge installed', () => {
  const prevEnv = process.env
  const prevPlatform = process.platform
  const prevCwd = process.cwd()
  let localAppData = ''

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-edge-win-'))
    localAppData = path.join(root, 'AppData', 'Local')
    fs.mkdirSync(localAppData, {recursive: true})
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    process.chdir(root)
    seen.env = null
    process.env = windowsOnlyCasing(
      localAppData
    ) as unknown as NodeJS.ProcessEnv

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

    await expect((plugin as any).launchChromium(compilation)).rejects.toThrow()

    expect(seen.env).not.toBeNull()

    const env = seen.env as NodeJS.ProcessEnv
    expect(env.PROGRAMFILES).toBe('C:\\Program Files')
    expect(env['PROGRAMFILES(X86)']).toBe('C:\\Program Files (x86)')
    expect(env.LOCALAPPDATA).toBe(localAppData)
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe(
      path.join(localAppData, 'extension.js', 'browsers', 'edge')
    )

    expect(env.EDGE_BINARY).toBeUndefined()
  })
})
