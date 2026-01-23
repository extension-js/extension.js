import {describe, it, expect, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {generateExtensionTypes} from '../generate-extension-types'

const created: string[] = []
function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {}
  }
  created.length = 0
})

describe('generate-extension-types', () => {
  it('writes extension-env.d.ts in package json dir', async () => {
    const root = makeTempDir('extjs-gen-types-')
    const pkgDir = root
    const manifestDir = root
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )
    await generateExtensionTypes(manifestDir, pkgDir)
    const target = path.join(pkgDir, 'extension-env.d.ts')
    expect(fs.existsSync(target)).toBe(true)
    const content = fs.readFileSync(target, 'utf8')
    expect(content).toContain('reference types="webextension-polyfill"')
    expect(content).toContain('declare global')
    expect(content).toContain("const browser: typeof import('webextension-polyfill')")
  })

  it.skip('writes extension-paths.d.ts with unions', async () => {
    const root = makeTempDir('extjs-gen-paths-')
    const pkgDir = root
    const manifestDir = root
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )
    fs.mkdirSync(path.join(root, 'public'), {recursive: true})
    fs.writeFileSync(path.join(root, 'public', 'logo.png'), '')
    fs.mkdirSync(path.join(root, 'pages'), {recursive: true})
    fs.writeFileSync(path.join(root, 'pages', 'home.html'), '')
    fs.mkdirSync(path.join(root, 'scripts'), {recursive: true})
    fs.writeFileSync(path.join(root, 'scripts', 'a.ts'), '')
    await generateExtensionTypes(manifestDir, pkgDir)
    const target = path.join(pkgDir, 'extension-paths.d.ts')
    expect(fs.existsSync(target)).toBe(true)
    const content = fs.readFileSync(target, 'utf8')
    expect(content).toContain("'public/logo.png'")
    expect(content).toContain("'/public/logo.png'")
    expect(content).toContain("'/logo.png'")
    expect(content).toContain("'pages/home.html'")
    expect(content).toContain("'scripts/a.ts'")
  })
})
