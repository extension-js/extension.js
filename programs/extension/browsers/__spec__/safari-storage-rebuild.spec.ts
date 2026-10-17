import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  packageSafariExtension,
  type SafariPipelineMode
} from '../run-safari/safari-launch'
import {type FakeSafariTools, fakeSafariTools} from './safari-fake-tools'

// Safari keeps an extension's storage under "<appex id> (<team id>)" in its
// WebKit data, so an ad-hoc signed build, which has no team, gets a fresh
// store each time Safari loads a rebuilt appex. Nothing the engine can sign
// locally changes that, so a dev session says so on every build it runs.
const STORAGE_RESET = "Safari reset the extension's storage"

let distDir: string

beforeEach(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-storage-'))
  fs.writeFileSync(
    path.join(distDir, 'manifest.json'),
    JSON.stringify({name: 'Storage Demo', version: '1.0.0'})
  )

  fs.writeFileSync(path.join(distDir, 'background.js'), 'void 0\n')
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(distDir, {recursive: true, force: true})
  fs.rmSync(`${distDir}-xcode`, {recursive: true, force: true})
})

function capture() {
  const lines: string[] = []
  const push = (m: string) => lines.push(String(m))

  return {
    lines,
    logger: {info: push, warn: push, error: push, debug: () => {}} as any
  }
}

async function run(
  tools: FakeSafariTools,
  mode: SafariPipelineMode,
  host: Record<string, unknown> = {}
) {
  const {lines, logger} = capture()

  await packageSafariExtension(
    {
      extension: [distDir],
      browser: 'safari',
      noOpen: true,
      announceDevReady: true,
      tools,
      ...host
    } as any,
    distDir,
    logger,
    mode
  )

  return lines
}

describe("a Safari dev rebuild and the extension's storage", () => {
  it('says Safari reset the storage on each ad-hoc rebuild', async () => {
    const tools = fakeSafariTools()
    await run(tools, 'full')

    fs.writeFileSync(path.join(distDir, 'background.js'), 'void 1\n')
    const first = await run(tools, 'resync')
    fs.writeFileSync(path.join(distDir, 'background.js'), 'void 2\n')
    const second = await run(tools, 'resync')

    expect(first.filter((l) => l.includes(STORAGE_RESET))).toHaveLength(1)
    expect(second.filter((l) => l.includes(STORAGE_RESET))).toHaveLength(1)
    expect(first.join('\n')).toContain('--development-team')
  })

  it('stays quiet about storage when a team signs the build', async () => {
    const tools = fakeSafariTools()
    await run(tools, 'full', {developmentTeam: 'ABCDE12345'})
    fs.writeFileSync(path.join(distDir, 'background.js'), 'void 1\n')
    const lines = await run(tools, 'resync', {developmentTeam: 'ABCDE12345'})

    expect(lines.some((l) => l.includes(STORAGE_RESET))).toBe(false)
  })

  it('leaves build packaging out of it', async () => {
    const tools = fakeSafariTools()
    const lines = await run(tools, 'full', {announceDevReady: false})

    expect(lines.some((l) => l.includes(STORAGE_RESET))).toBe(false)
  })
})

describe('a Safari session start with nothing changed', () => {
  it('reuses the built app instead of running xcodebuild again', async () => {
    const tools = fakeSafariTools()
    await run(tools, 'full')
    const second = await run(tools, 'full')

    expect(tools.calls.xcodebuild).toHaveLength(1)
    expect(second.some((l) => l.includes(STORAGE_RESET))).toBe(false)
  })

  it('builds again once a file in the build changed', async () => {
    const tools = fakeSafariTools()
    await run(tools, 'full')
    fs.writeFileSync(path.join(distDir, 'background.js'), 'void 1\n')
    await run(tools, 'full')

    expect(tools.calls.xcodebuild).toHaveLength(2)
  })

  it('builds again when the built app is gone', async () => {
    const tools = fakeSafariTools()
    await run(tools, 'full')
    fs.rmSync(path.join(`${distDir}-xcode`, '.derived'), {
      recursive: true,
      force: true
    })

    await run(tools, 'full')

    expect(tools.calls.xcodebuild).toHaveLength(2)
  })

  it('builds again when the signing team changes', async () => {
    const tools = fakeSafariTools()
    await run(tools, 'full')
    await run(tools, 'full', {developmentTeam: 'ABCDE12345'})

    expect(tools.calls.xcodebuild).toHaveLength(2)
  })
})
