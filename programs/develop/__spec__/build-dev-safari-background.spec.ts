import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A project with no background gets a dev-only reload background. Safari
// never starts an MV3 service worker, so on a Safari dev build that injected
// background has to be listed under scripts or the dev bridge never connects.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-safari-bg-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'no-background', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'popup.html'), '<p>popup</p>\n')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'no-background',
      version: '1.0.0',
      manifest_version: 3,
      action: {default_popup: 'popup.html'}
    })
  )

  return root
}

async function devBuild(root: string, browser: 'chrome' | 'safari') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error

  const quiet = () => {}

  console.log = quiet
  console.warn = quiet
  console.error = quiet

  try {
    // Only the dev session (named by its command) takes the dev manifest,
    // and the packager stays out because no safariPackager is passed.
    const summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'development',
      metadataCommand: 'dev',
      exitOnError: false
    } as any)

    expect(summary.errors_count).toBe(0)
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', browser)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )

  return {manifest, distDir}
}

describe('dev-injected background on a project with no background', () => {
  it('safari lists the injected bundle under scripts with no persistent key', async () => {
    const {manifest, distDir} = await devBuild(project(), 'safari')

    expect(manifest.background).toEqual({
      scripts: ['background/service_worker.js']
    })

    expect(
      fs.existsSync(path.join(distDir, 'background', 'service_worker.js'))
    ).toBe(true)
  }, 180_000)

  it('chrome keeps the injected bundle as a service worker', async () => {
    const {manifest, distDir} = await devBuild(project(), 'chrome')

    expect(manifest.background).toEqual({
      service_worker: 'background/service_worker.js'
    })

    expect(
      fs.existsSync(path.join(distDir, 'background', 'service_worker.js'))
    ).toBe(true)
  }, 180_000)
})
