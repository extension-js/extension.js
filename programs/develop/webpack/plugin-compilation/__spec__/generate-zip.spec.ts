import {describe, it, expect, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {ZipPlugin} from '../zip'
import {rspack} from '@rspack/core'

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

describe('ZipPlugin', () => {
  it('writes dist zips when options.zip or zipSource are set', async () => {
    const root = makeTempDir('extjs-zip-')
    // ensure .gitignore exists to satisfy getFilesToZip
    fs.writeFileSync(path.join(root, '.gitignore'), '')
    const dist = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(dist, {recursive: true})
    // minimal manifest in output dir (distribution zip)
    fs.writeFileSync(
      path.join(dist, 'manifest.json'),
      JSON.stringify({name: 'x', version: '1.0.0'})
    )
    // also put a manifest at project root for source zipping
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x', version: '1.0.0'})
    )

    const compiler = rspack({
      mode: 'production',
      context: root,
      entry: {},
      output: {path: dist}
    })
    new ZipPlugin({
      browser: 'chrome',
      zipData: {zip: true, zipSource: true}
    }).apply(compiler as any)

    await new Promise<void>((resolve, reject) =>
      compiler.run((err) => (err ? reject(err) : resolve()))
    )
    const files = fs.readdirSync(path.join(root, 'dist', 'chrome'))
    const hasDistZip = files.some((f) => f.endsWith('.zip'))
    expect(hasDistZip).toBe(true)
    const rootFiles = fs.readdirSync(path.join(root, 'dist'))
    const hasSourceZip = rootFiles.some(
      (f) => f.includes('-source.') && f.endsWith('.zip')
    )
    expect(hasSourceZip).toBe(true)
  })
})
