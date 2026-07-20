import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {resolveAbsoluteFsPath} from '../../html-lib/utils'

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
    const {absoluteFsPath} = resolveAbsoluteFsPath({
      asset: '/pages/nested.js',
      projectRoot: root,
      publicRootForResource: path.join(root, 'public'),
      outputRoot: path.join(root, 'dist', 'chromium'),
      manifestRoot: root
    })
    expect(absoluteFsPath.startsWith(path.join(root, 'dist', 'chromium'))).toBe(
      false
    )
  })
})
