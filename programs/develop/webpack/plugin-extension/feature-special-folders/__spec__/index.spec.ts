import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

let tempDir: string
let fixturesPath: string

const assertFileIsEmitted = async (filePath: string) => {
  const start = Date.now()
  const timeoutMs = 10000
  const intervalMs = 50
  while (Date.now() - start < timeoutMs) {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK)
      return expect(undefined).toBeUndefined()
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`File not found in time: ${filePath}`)
}

describe('SpecialFoldersPlugin', () => {
  const outputPathBase = () => path.resolve(fixturesPath, 'dist', 'chrome')

  beforeAll(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'special-folders-')
    )
    fixturesPath = tempDir
    const publicDir = path.join(fixturesPath, 'public')
    await fs.promises.mkdir(publicDir, {recursive: true})
    await fs.promises.writeFile(
      path.join(publicDir, 'logo.svg'),
      '<svg/>',
      'utf8'
    )
    await fs.promises.mkdir(path.join(fixturesPath, 'public', 'css'), {
      recursive: true
    })
    await fs.promises.writeFile(
      path.join(fixturesPath, 'public', 'css', 'file.css'),
      'body{}',
      'utf8'
    )
    await fs.promises.mkdir(path.join(fixturesPath, 'public', 'html'), {
      recursive: true
    })
    await fs.promises.writeFile(
      path.join(fixturesPath, 'public', 'html', 'file.html'),
      '<!doctype html>',
      'utf8'
    )
    await fs.promises.mkdir(path.join(fixturesPath, 'public', 'img'), {
      recursive: true
    })
    await fs.promises.writeFile(
      path.join(fixturesPath, 'public', 'img', 'icon.png'),
      '',
      'utf8'
    )
    await extensionBuild(fixturesPath, {browser: 'chrome'})
  })

  afterAll(() => {
    const outputPath = outputPathBase()
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, {recursive: true, force: true})
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, {recursive: true, force: true})
    }
  })

  describe('public folder copy', () => {
    it('copies files from public/ to the output directory root preserving structure', async () => {
      // A few representative assets that should be copied by CopyPublicFolder
      const outputPath = outputPathBase()
      const css = path.join(outputPath, 'css', 'file.css')
      const html = path.join(outputPath, 'html', 'file.html')
      const img = path.join(outputPath, 'img', 'icon.png')
      const logo = path.join(outputPath, 'logo.svg')

      await assertFileIsEmitted(css)
      await assertFileIsEmitted(html)
      await assertFileIsEmitted(img)
      await assertFileIsEmitted(logo)
    })
  })
})
