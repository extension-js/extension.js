import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const getFixturesPath = (demoDir: string) =>
  path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'examples',
    demoDir
  )

async function waitForFile(
  filePath: string,
  timeoutMs: number = 10000,
  intervalMs: number = 50
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`File not found in time: ${filePath}`)
}

describe('ScriptsPlugin (no wrapper when directive is absent)', () => {
  const fixturesPath = getFixturesPath('special-folders-scripts')
  const outputPath = path.resolve(fixturesPath, 'dist', 'chrome')

  beforeAll(async () => {
    await extensionBuild(fixturesPath, {
      browser: 'chrome',
      silent: true,
      exitOnError: false as any
    })
  }, 30000)

  afterAll(async () => {
    if (fs.existsSync(outputPath)) {
      await fs.promises.rm(outputPath, {recursive: true, force: true})
    }
  })

  it('emits content script without Shadow DOM wrapper constructs', async () => {
    const manifestPath = path.join(outputPath, 'manifest.json')
    await waitForFile(manifestPath)
    const manifestText = await fs.promises.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestText) as chrome.runtime.ManifestV3

    const cs = manifest.content_scripts?.[0]?.js?.[0]
    expect(typeof cs).toBe('string')

    const csPath = path.join(outputPath, cs as string)
    await waitForFile(csPath)
    const code = await fs.promises.readFile(csPath, 'utf-8')

    // No wrapper-specific patterns
    expect(code).not.toMatch(/attachShadow\(\{\s*mode:\s*['"]open['"]\s*\}\)/)
    expect(code).not.toMatch(/document\.createElement\(\s*['"]style['"]\s*\)/)
  })
})
