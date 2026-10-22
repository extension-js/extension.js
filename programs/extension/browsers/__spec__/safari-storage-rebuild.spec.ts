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
// WebKit data, with UNSIGNED in the team slot for an ad-hoc build, so the
// store survives a rebuild even though every ad-hoc signature carries a new
// cdhash. Measured on Safari 27.0 (macOS 26.5.2): a storage.local key written
// by build A read back unchanged after two ad-hoc rebuilds (ledger 1043). An
// earlier warning said the opposite and asked for a team id, so a dev session
// never says a rebuild resets storage, signed or not.
const STORAGE_RESET = /reset the extension's storage|--development-team/

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
  it('never says an ad-hoc rebuild reset the storage', async () => {
    const tools = fakeSafariTools()
    const lines = [...(await run(tools, 'full'))]

    fs.writeFileSync(path.join(distDir, 'background.js'), 'void 1\n')
    lines.push(...(await run(tools, 'resync')))
    fs.writeFileSync(path.join(distDir, 'background.js'), 'void 2\n')
    lines.push(...(await run(tools, 'resync')))

    expect(tools.calls.xcodebuild).toHaveLength(3)
    expect(lines.filter((l) => STORAGE_RESET.test(l))).toEqual([])
  })

  it('says in the setup steps that storage.local survives rebuilds', async () => {
    const tools = fakeSafariTools()
    const lines = await run(tools, 'full', {noOpen: false})

    expect(lines.join('\n')).toMatch(/storage\.local.*survives rebuilds/)
  })

  it('stays quiet about storage when a team signs the build', async () => {
    const tools = fakeSafariTools()
    await run(tools, 'full', {developmentTeam: 'ABCDE12345'})
    fs.writeFileSync(path.join(distDir, 'background.js'), 'void 1\n')
    const lines = await run(tools, 'resync', {developmentTeam: 'ABCDE12345'})

    expect(lines.some((l) => STORAGE_RESET.test(l))).toBe(false)
  })
})

describe('a Safari session start with nothing changed', () => {
  it('reuses the built app instead of running xcodebuild again', async () => {
    const tools = fakeSafariTools()
    await run(tools, 'full')
    const second = await run(tools, 'full')

    expect(tools.calls.xcodebuild).toHaveLength(1)
    expect(second.some((l) => STORAGE_RESET.test(l))).toBe(false)
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
