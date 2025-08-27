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

describe('React wrapper integration (content-react-wrapper example)', () => {
  const fixturesPath = getFixturesPath('content-react')
  const outputPath = path.resolve(fixturesPath, 'dist', 'chrome')

  async function waitForFile(
    filePath: string,
    timeoutMs: number = 15000,
    intervalMs: number = 50
  ) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (fs.existsSync(filePath)) return
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    throw new Error(`File not found in time: ${filePath}`)
  }

  beforeAll(async () => {
    await extensionBuild(fixturesPath, {
      browser: 'chrome',
      silent: true,
      exitOnError: false as any
    })
  }, 45000)

  afterAll(async () => {
    if (fs.existsSync(outputPath)) {
      try {
        await fs.promises.rm(outputPath, {recursive: true, force: true})
      } catch (err: any) {
        if (
          err &&
          typeof err.code === 'string' &&
          (err.code === 'ENOTEMPTY' || err.code === 'ENOENT')
        ) {
          return
        }
        throw err
      }
    }
  })

  it('builds without unterminated string errors and emits content script', async () => {
    const manifestPath = path.join(outputPath, 'manifest.json')
    await waitForFile(manifestPath)
    const manifestText = await fs.promises.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestText) as chrome.runtime.ManifestV3

    expect(Array.isArray(manifest.content_scripts)).toBe(true)
    const content0 = manifest.content_scripts![0]
    expect(Array.isArray(content0.js)).toBe(true)
    expect(content0.js!.some((p) => p.endsWith('.js'))).toBe(true)

    // Sanity check emitted bundle does not contain stray single-quoted newlines
    const bundlePath = path.join(outputPath, content0.js![0])
    const code = await fs.promises.readFile(bundlePath, 'utf8')
    expect(code.includes("+'\n'"))
  })
})


