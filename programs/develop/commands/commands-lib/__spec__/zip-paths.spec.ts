import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import {describe, it, expect, afterEach} from 'vitest'
import {generateZip} from '../generate-zip'

function makeTempProject(name = 'Zip Paths'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-zip-'))
  fs.mkdirSync(path.join(root, 'dist', 'chrome'), {recursive: true})
  // create manifest in project root (for zipSource)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({name, version: '9.9.9', manifest_version: 3})
  )
  // create manifest in dist/chrome (for dist zip)
  fs.writeFileSync(
    path.join(root, 'dist', 'chrome', 'manifest.json'),
    JSON.stringify({name, version: '9.9.9', manifest_version: 3})
  )
  // add a couple of files so zips are non-empty
  fs.writeFileSync(path.join(root, 'dist', 'chrome', 'a.js'), 'console.log(1)')
  fs.writeFileSync(path.join(root, '.gitignore'), '\nnode_modules\n')
  return root
}

describe('generateZip path handling', () => {
  let temp: string | undefined
  afterEach(() => {
    if (temp) {
      try {
        fs.rmSync(temp, {recursive: true, force: true})
      } catch {}
      temp = undefined
    }
  })

  it('creates platform-agnostic zip paths (dist and source)', async () => {
    temp = makeTempProject('Zip Paths')
    await generateZip(temp, {
      browser: 'chrome',
      zip: true,
      zipSource: true,
      zipFilename: 'zip-paths'
    })

    const distDir = path.join(temp, 'dist', 'chrome')
    const rootDistDir = path.join(temp, 'dist')
    const distFiles = fs.readdirSync(distDir)
    const rootFiles = fs.readdirSync(rootDistDir)
    const distMatch = distFiles.find((f) => /^zip-paths\.zip$/.test(f))
    const srcMatch = rootFiles.find((f) => /^zip-paths-source\.zip$/.test(f))
    expect(Boolean(distMatch)).toBe(true)
    expect(Boolean(srcMatch)).toBe(true)
  })
})
