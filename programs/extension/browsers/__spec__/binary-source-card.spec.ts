import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

const located = {path: null as string | null}

vi.mock('edge-location', () => ({
  default: () => located.path,
  getInstallGuidance: () => 'install edge (raw guidance)',
  getEdgeVersion: () => null
}))

import {
  binaryProvenanceNote,
  runningInDevelopment
} from '../browsers-lib/messages'
import {stampReadyBrowserLaunch} from '../browsers-lib/ready-stamp'
import {classifyBinaryProvenance} from '../browsers-lib/shared-utils'
import {createChromiumContext} from '../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../run-chromium/chromium-launch'

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')

function edgeCard(binaryProvenance: 'managed' | 'system') {
  return stripAnsi(
    runningInDevelopment(
      {name: 'My Extension', version: '1.0.0'},
      'edge',
      {
        data: {
          id: 'pjkghmlbdmhkfellgkkcolmnlhwmubhe',
          management: {name: 'My Extension', version: '1.0.0'}
        }
      },
      'Microsoft Edge 142.0.3595.53',
      undefined,
      {binaryProvenance}
    )
  )
}

describe('a session names a system binary it resolved', () => {
  const prevEnv = process.env
  const prevCwd = process.cwd()
  let root = ''
  let cacheRoot = ''
  let systemEdge = ''
  let outputPath = ''
  let log: MockInstance<typeof console.log>

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ext-binary-source-'))
    )

    cacheRoot = path.join(root, 'cache', 'browsers')
    // What the Edge installer leaves on macOS: a marker, and no binary.
    fs.mkdirSync(path.join(cacheRoot, 'edge', '.links'), {recursive: true})
    fs.writeFileSync(path.join(cacheRoot, 'edge', '.links', 'marker'), 'x')

    systemEdge = path.join(root, 'system', 'msedge')
    fs.mkdirSync(path.dirname(systemEdge), {recursive: true})
    fs.writeFileSync(
      systemEdge,
      '#!/bin/sh\necho "Microsoft Edge 142.0.3595.53"\n'
    )

    fs.chmodSync(systemEdge, 0o755)
    located.path = systemEdge

    outputPath = path.join(root, 'dist', 'edge')
    fs.mkdirSync(outputPath, {recursive: true})
    fs.writeFileSync(
      path.join(outputPath, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'x', version: '1.0.0'})
    )

    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    process.chdir(root)

    // The launcher only resolves a binary outside the test runner's env.
    process.env = {
      PATH: prevEnv.PATH,
      HOME: root,
      USERPROFILE: root,
      LOCALAPPDATA: path.join(root, 'AppData', 'Local'),
      EXT_BROWSERS_CACHE_DIR: cacheRoot,
      FORCE_COLOR: '0',
      NO_COLOR: '1'
    } as unknown as NodeJS.ProcessEnv

    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = prevEnv
    process.chdir(prevCwd)
    vi.restoreAllMocks()
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('plans the located Edge when the managed cache holds no binary, and classes it system', async () => {
    const plugin = new ChromiumLaunchPlugin(
      {browser: 'edge', extension: [outputPath], dryRun: true} as any,
      createChromiumContext() as any
    )

    await (plugin as any).launchChromium({
      options: {output: {path: outputPath}, mode: 'development'},
      outputOptions: {path: outputPath}
    })

    const printed = stripAnsi(
      log.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    )

    expect(printed).toContain(systemEdge)

    expect(
      classifyBinaryProvenance({
        binaryPath: systemEdge,
        managedCacheRoot: cacheRoot
      })
    ).toBe('system')
  })

  it('prints the source on the Browser row only when it is the system', () => {
    expect(edgeCard('system')).toContain(
      'Browser        Microsoft Edge 142.0.3595.53 (system install)'
    )

    const managed = edgeCard('managed')
    expect(managed).toContain('Browser        Microsoft Edge 142.0.3595.53')
    expect(managed).not.toContain('(')
  })

  it('notes the system only for a browser the managed cache can hold', () => {
    for (const browser of ['chrome', 'chromium', 'edge', 'firefox']) {
      expect(binaryProvenanceNote('system', browser)).toBe('(system install)')
    }

    // These only ever run from the system, so the note would say nothing.
    for (const browser of ['brave', 'vivaldi', 'zen', 'safari']) {
      expect(binaryProvenanceNote('system', browser)).toBe('')
    }
  })

  it('stamps the binary and its source on the ready contract', () => {
    const readyPath = path.join(
      root,
      'dist',
      'extension-js',
      'edge',
      'ready.json'
    )
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))

    stampReadyBrowserLaunch(outputPath, {
      binary: systemEdge,
      binaryProvenance: classifyBinaryProvenance({
        binaryPath: systemEdge,
        managedCacheRoot: cacheRoot
      })
    })

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.binary).toBe(systemEdge)
    expect(ready.binaryProvenance).toBe('system')
  })
})
