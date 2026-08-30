import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {patchHtml, patchHtmlNested} from '../../html-lib/patch-html'

function makeTmp(name: string) {
  const tmp = path.join(__dirname, `.tmp-${name}`)
  fs.rmSync(tmp, {recursive: true, force: true})
  fs.mkdirSync(tmp, {recursive: true})
  return tmp
}

function writeFile(filePath: string, contents = 'x') {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, contents)
}

function makeCompilation(mode: 'development' | 'production'): Compilation {
  const compilation = {
    options: {mode} as Compilation['options'],
    getAsset: (name: string) =>
      name.endsWith('.css') ? ({source: {}} as any) : undefined,
    emitAsset() {},
    updateAsset() {},
    warnings: []
  }

  return compilation as unknown as Compilation
}

describe('patchHtml static attribute rewrites', () => {
  it('keeps video src on the movie and poster on the poster frame', () => {
    const tmp = makeTmp('video-poster')
    writeFile(path.join(tmp, 'intro.mp4'), 'movie')
    writeFile(path.join(tmp, 'poster.jpg'), 'frame')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><body><video src="intro.mp4" poster="poster.jpg"></video></body></html>`
    )

    const updated = patchHtml(
      makeCompilation('production'),
      'feature/index',
      htmlPath,
      {'feature/index': htmlPath}
    )

    expect(updated).toContain('src="/assets/intro.mp4"')
    expect(updated).toContain('poster="/assets/poster.jpg"')
    expect(updated).not.toContain('src="/assets/poster.jpg"')
    expect(updated).not.toContain('poster="/assets/intro.mp4"')
  })

  it('rewrites every srcset candidate and leaves the fallback src alone', () => {
    const tmp = makeTmp('img-srcset')
    writeFile(path.join(tmp, 'hero.png'))
    writeFile(path.join(tmp, 'hero-2x.png'))
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><body><img src="hero.png" srcset="hero.png 1x, hero-2x.png 2x"></body></html>`
    )

    const updated = patchHtml(
      makeCompilation('production'),
      'feature/index',
      htmlPath,
      {'feature/index': htmlPath}
    )

    expect(updated).toContain('src="/assets/hero.png"')
    expect(updated).toContain(
      'srcset="/assets/hero.png 1x, /assets/hero-2x.png 2x"'
    )
    expect(updated).not.toContain('src="/assets/hero-2x.png"')
  })

  it('rewrites art-directed <source srcset> and the fallback img', () => {
    const tmp = makeTmp('picture')
    writeFile(path.join(tmp, 'hero.webp'))
    writeFile(path.join(tmp, 'hero.jpg'))
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><body><picture><source type="image/webp" srcset="hero.webp"><img src="hero.jpg"></picture></body></html>`
    )

    const updated = patchHtml(
      makeCompilation('production'),
      'feature/index',
      htmlPath,
      {'feature/index': htmlPath}
    )

    expect(updated).toContain('srcset="/assets/hero.webp"')
    expect(updated).toContain('src="/assets/hero.jpg"')
    expect(updated).not.toContain('src="hero.webp"')
  })

  it('rewrites preload imagesrcset without inventing an href', () => {
    const tmp = makeTmp('preload-srcset')
    writeFile(path.join(tmp, 'hero.png'))
    writeFile(path.join(tmp, 'hero-2x.png'))
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head><link rel="preload" as="image" imagesrcset="hero.png 1x, hero-2x.png 2x"></head><body></body></html>`
    )

    const updated = patchHtml(
      makeCompilation('production'),
      'feature/index',
      htmlPath,
      {'feature/index': htmlPath}
    )

    const preload = updated.match(/<link rel="preload"[^>]*>/)?.[0] || ''
    expect(preload).toContain(
      'imagesrcset="/assets/hero.png 1x, /assets/hero-2x.png 2x"'
    )
    expect(preload).not.toMatch(/\shref=/)
  })

  it('rewrites a plain image src the same way as before', () => {
    const tmp = makeTmp('plain-img')
    writeFile(path.join(tmp, 'logo.png'))
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(htmlPath, `<html><body><img src="logo.png"></body></html>`)

    const updated = patchHtml(
      makeCompilation('production'),
      'feature/index',
      htmlPath,
      {'feature/index': htmlPath}
    )

    expect(updated).toContain('src="/assets/logo.png"')
  })
})

describe('patchHtmlNested static attribute rewrites', () => {
  it('rewrites nested video src and poster independently', () => {
    const tmp = makeTmp('nested-video')
    writeFile(path.join(tmp, 'intro.mp4'), 'movie')
    writeFile(path.join(tmp, 'poster.jpg'), 'frame')
    const htmlPath = path.join(tmp, 'nested.html')
    fs.writeFileSync(
      htmlPath,
      `<html><body><video src="intro.mp4" poster="poster.jpg"></video></body></html>`
    )

    const updated = patchHtmlNested(makeCompilation('production'), htmlPath)

    expect(updated).toContain('src="/assets/intro.mp4"')
    expect(updated).toContain('poster="/assets/poster.jpg"')
    expect(updated).not.toContain('src="/assets/poster.jpg"')
  })
})
