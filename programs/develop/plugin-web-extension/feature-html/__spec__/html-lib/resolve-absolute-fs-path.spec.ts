import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  cleanLeading,
  resolveAbsoluteFsPath,
  rootUrlPath
} from '../../html-lib/utils'

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
  fs.mkdirSync(path.join(root, 'public', '.well-known'), {recursive: true})
  fs.writeFileSync(path.join(root, 'public', '.well-known', 'links.json'), '[]')
  fs.writeFileSync(path.join(root, 'public', '.env'), 'KEY=\n')
  fs.writeFileSync(path.join(root, '.env'), 'KEY=\n')
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

  const resolve = (asset: string) =>
    resolveAbsoluteFsPath({
      asset,
      projectRoot: root,
      publicRootForResource: path.join(root, 'public'),
      outputRoot: path.join(root, 'dist', 'chromium'),
      manifestRoot: root
    })

  it('keeps the leading dot of a name', () => {
    expect(resolve('/.well-known/links.json')).toEqual({
      absoluteFsPath: path.join(root, 'public', '.well-known', 'links.json'),
      isUnderPublicRoot: true,
      isRootUrl: true
    })

    expect(resolve('/.missing').absoluteFsPath).toBe(
      path.join(root, '.missing')
    )
  })

  it('does not let public/ answer for a name the copier leaves out', () => {
    expect(resolve('/.env')).toEqual({
      absoluteFsPath: path.join(root, '.env'),
      isUnderPublicRoot: false,
      isRootUrl: true
    })
  })

  it('resolves dot segments the way the browser does', () => {
    expect(resolve('/pages/../.env').absoluteFsPath).toBe(
      path.join(root, '.env')
    )

    expect(resolve('/../pages/nested.html').absoluteFsPath).toBe(
      path.join(root, 'pages', 'nested.html')
    )
  })
})

describe('root URL paths', () => {
  it('strips slashes and ./ and nothing else', () => {
    expect(cleanLeading('/.env')).toBe('.env')
    expect(cleanLeading('./public/a.png')).toBe('public/a.png')
    expect(cleanLeading('//a/b')).toBe('a/b')
    expect(cleanLeading('.well-known/x')).toBe('.well-known/x')
  })

  it('never climbs above the extension root', () => {
    expect(rootUrlPath('/a/../.envrc')).toBe('.envrc')
    expect(rootUrlPath('/../../x.txt')).toBe('x.txt')
    expect(rootUrlPath('/logo.png')).toBe('logo.png')
  })
})
