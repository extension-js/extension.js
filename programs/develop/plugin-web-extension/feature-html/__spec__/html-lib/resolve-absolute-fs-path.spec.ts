import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {resolveAbsoluteFsPath} from '../../html-lib/utils'

// Layout mirroring the wild subject that broke: manifest at the project root,
// a nested page at pages/nested.html referenced root-absolutely
// (<iframe src="/pages/nested.html">), and a dist output containing the
// PATCHED copy of the same page.
let root: string
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-abs-'))
  fs.mkdirSync(path.join(root, 'pages'), {recursive: true})
  fs.writeFileSync(path.join(root, 'pages', 'nested.html'), '<html></html>')
  fs.mkdirSync(path.join(root, 'dist', 'chromium', 'pages'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'dist', 'chromium', 'pages', 'nested.html'),
    '<html><script src="/pages/nested.js"></script></html>'
  )
  fs.mkdirSync(path.join(root, 'public'), {recursive: true})
  fs.writeFileSync(path.join(root, 'public', 'logo.png'), 'png')
})
afterAll(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

describe('resolveAbsoluteFsPath root URLs', () => {
  it('resolves a root URL to the manifest-relative SOURCE file, never the dist copy', () => {
    const {absoluteFsPath, isRootUrl} = resolveAbsoluteFsPath({
      asset: '/pages/nested.html',
      projectRoot: root,
      publicRootForResource: path.join(root, 'public'),
      outputRoot: path.join(root, 'dist', 'chromium'),
      manifestRoot: root
    })
    expect(isRootUrl).toBe(true)
    expect(absoluteFsPath).toBe(path.join(root, 'pages', 'nested.html'))
  })

  it('still prefers the public root when the file exists there', () => {
    const {absoluteFsPath, isRootUrl} = resolveAbsoluteFsPath({
      asset: '/logo.png',
      projectRoot: root,
      publicRootForResource: path.join(root, 'public'),
      outputRoot: path.join(root, 'dist', 'chromium'),
      manifestRoot: root
    })
    expect(isRootUrl).toBe(true)
    expect(absoluteFsPath).toBe(path.join(root, 'public', 'logo.png'))
  })

  it('does not resolve a missing root URL into the output dir', () => {
    // /pages/nested.js exists ONLY inside dist (a compiled ref rewritten into
    // patched HTML). Resolving it into outputRoot fed our own output back as
    // input; the returned path must stay outside outputRoot.
    const {absoluteFsPath} = resolveAbsoluteFsPath({
      asset: '/pages/nested.js',
      projectRoot: root,
      publicRootForResource: path.join(root, 'public'),
      outputRoot: path.join(root, 'dist', 'chromium'),
      manifestRoot: root
    })
    expect(
      absoluteFsPath.startsWith(path.join(root, 'dist', 'chromium'))
    ).toBe(false)
  })
})
