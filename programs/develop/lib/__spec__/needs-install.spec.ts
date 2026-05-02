import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const created: string[] = []

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

afterEach(() => {
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {}
  }
  created.length = 0
})

describe('needsInstall', () => {
  it('returns true when node_modules is missing', async () => {
    const project = makeTempDir('extjs-needs-install-')
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({name: 'x', dependencies: {tailwindcss: '^3.4.13'}})
    )

    const {needsInstall, asAbsolute} = await import('../paths')
    expect(needsInstall(asAbsolute(project))).toBe(true)
  })

  it('returns true when node_modules exists but dependencies are not present', async () => {
    const project = makeTempDir('extjs-needs-install-')
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({name: 'x', dependencies: {tailwindcss: '^3.4.13'}})
    )
    fs.mkdirSync(path.join(project, 'node_modules'), {recursive: true})

    const {needsInstall, asAbsolute} = await import('../paths')
    expect(needsInstall(asAbsolute(project))).toBe(true)
  })

  it('returns false when dependency folder exists', async () => {
    const project = makeTempDir('extjs-needs-install-')
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({name: 'x', dependencies: {tailwindcss: '^3.4.13'}})
    )
    fs.mkdirSync(path.join(project, 'node_modules', 'tailwindcss'), {
      recursive: true
    })

    const {needsInstall, asAbsolute} = await import('../paths')
    expect(needsInstall(asAbsolute(project))).toBe(false)
  })

  it('returns false when at least one declared dependency exists', async () => {
    const project = makeTempDir('extjs-needs-install-')
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({
        name: 'x',
        dependencies: {tailwindcss: '^3.4.13', autoprefixer: '^10.4.20'}
      })
    )
    fs.mkdirSync(path.join(project, 'node_modules', 'tailwindcss'), {
      recursive: true
    })

    const {needsInstall, asAbsolute} = await import('../paths')
    expect(needsInstall(asAbsolute(project))).toBe(false)
  })

  it('returns false when package.json is missing (web-only mode)', async () => {
    // Regression: vanilla Chrome samples (e.g. sample.page-redder) cloned via
    // `extension dev <github-url>` ship a manifest.json but no package.json.
    // Returning true here would trigger `npm install` against a directory
    // with no package.json and crash with ENOENT.
    const project = makeTempDir('extjs-needs-install-webonly-')

    const {needsInstall, asAbsolute} = await import('../paths')
    expect(needsInstall(asAbsolute(project))).toBe(false)
  })

  it('returns false when package.json is missing even if node_modules exists', async () => {
    const project = makeTempDir('extjs-needs-install-webonly-nm-')
    fs.mkdirSync(path.join(project, 'node_modules'), {recursive: true})

    const {needsInstall, asAbsolute} = await import('../paths')
    expect(needsInstall(asAbsolute(project))).toBe(false)
  })

  it('returns false when .pnpm directory exists', async () => {
    const project = makeTempDir('extjs-needs-install-')
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({
        name: 'x',
        dependencies: {tailwindcss: '^3.4.13'}
      })
    )
    fs.mkdirSync(path.join(project, 'node_modules', '.pnpm'), {
      recursive: true
    })

    const {needsInstall, asAbsolute} = await import('../paths')
    expect(needsInstall(asAbsolute(project))).toBe(false)
  })
})
