import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {evictAssetsFromHtmlCache, getAssetsFromHtml} from '../../html-lib/utils'

describe('getAssetsFromHtml', () => {
  const tmp = path.join(__dirname, '.tmp-utils')
  fs.mkdirSync(tmp, {recursive: true})

  it('throws when the HTML file is missing instead of reporting an empty page', () => {
    expect(() => getAssetsFromHtml(path.join(tmp, 'missing.html'))).toThrow()
  })

  it('does not throw for missing files when inline content is provided', () => {
    const res = getAssetsFromHtml(
      path.join(tmp, 'missing-inline.html'),
      '<html><body><script src="a.js"></script></body></html>'
    )
    expect(res.js).toEqual([path.join(tmp, 'a.js')])
  })

  it('serves the cached parse for an unchanged mtime and size, and eviction drops it', () => {
    const dir = path.join(tmp, 'cache-evict')
    fs.mkdirSync(dir, {recursive: true})
    const htmlPath = path.join(dir, 'index.html')

    // Same byte length and a pinned whole-second mtime on both writes so the
    // mtimeMs:size cache key collides on purpose
    const pinned = new Date(Math.floor(Date.now() / 1000) * 1000 - 5000)
    fs.writeFileSync(htmlPath, '<script src="a.js"></script>', 'utf8')
    fs.utimesSync(htmlPath, pinned, pinned)

    const first = getAssetsFromHtml(htmlPath)
    expect(first.js).toEqual([path.join(dir, 'a.js')])

    fs.writeFileSync(htmlPath, '<script src="b.js"></script>', 'utf8')
    fs.utimesSync(htmlPath, pinned, pinned)

    const cached = getAssetsFromHtml(htmlPath)
    expect(cached.js).toEqual([path.join(dir, 'a.js')])

    evictAssetsFromHtmlCache(htmlPath)

    const fresh = getAssetsFromHtml(htmlPath)
    expect(fresh.js).toEqual([path.join(dir, 'b.js')])
  })

  it('evicts every entry when called without a path', () => {
    const dir = path.join(tmp, 'cache-clear')
    fs.mkdirSync(dir, {recursive: true})
    const htmlPath = path.join(dir, 'index.html')

    const pinned = new Date(Math.floor(Date.now() / 1000) * 1000 - 5000)
    fs.writeFileSync(htmlPath, '<script src="a.js"></script>', 'utf8')
    fs.utimesSync(htmlPath, pinned, pinned)
    getAssetsFromHtml(htmlPath)

    fs.writeFileSync(htmlPath, '<script src="b.js"></script>', 'utf8')
    fs.utimesSync(htmlPath, pinned, pinned)

    evictAssetsFromHtmlCache()

    const fresh = getAssetsFromHtml(htmlPath)
    expect(fresh.js).toEqual([path.join(dir, 'b.js')])
  })

  it('reports <script type="module"> sources in moduleJs (case-insensitive)', () => {
    const html = `
		<html>
		<body>
		  <script type="module" src="main.js"></script>
		  <script type="Module" src="upper.js"></script>
		  <script src="classic.js"></script>
		  <script type="text/javascript" src="legacy.js"></script>
		</body>
		</html>
		`
    const dir = path.join(tmp, 'modulejs')
    fs.mkdirSync(dir, {recursive: true})
    const htmlPath = path.join(dir, 'index.html')
    fs.writeFileSync(htmlPath, html, 'utf8')
    const res = getAssetsFromHtml(htmlPath)
    expect(res.js).toEqual([
      path.join(dir, 'main.js'),
      path.join(dir, 'upper.js'),
      path.join(dir, 'classic.js'),
      path.join(dir, 'legacy.js')
    ])
    expect(res.moduleJs).toEqual([
      path.join(dir, 'main.js'),
      path.join(dir, 'upper.js')
    ])
  })

  it('treats icon-family rel token lists as static assets, not stylesheets', () => {
    const html = `
		<html>
		<head>
		  <link rel="shortcut icon" href="logo.png">
		  <link rel="SHORTCUT ICON" href="upper.png">
		  <link rel="apple-touch-icon" href="touch.png">
		  <link rel="mask-icon" href="mask.svg">
		  <link rel="stylesheet" href="styles.css">
		</head>
		<body></body>
		</html>
		`
    const dir = path.join(tmp, 'rel-tokens')
    fs.mkdirSync(dir, {recursive: true})
    const htmlPath = path.join(dir, 'index.html')
    fs.writeFileSync(htmlPath, html, 'utf8')
    const res = getAssetsFromHtml(htmlPath)
    expect(res.static).toEqual([
      path.join(dir, 'logo.png'),
      path.join(dir, 'upper.png'),
      path.join(dir, 'touch.png'),
      path.join(dir, 'mask.svg')
    ])
    expect(res.css).toEqual([path.join(dir, 'styles.css')])
  })

  it('extracts js, css, and static with base href and preserves public-root', () => {
    const html = `
		<html>
		<head>
		  <base href="/root/">
		  <link rel="stylesheet" href="styles.css">
		  <link rel="icon" href="/public/favicon.png">
		</head>
		<body>
		  <script src="main.js"></script>
		  <img src="/public/logo.png">
		</body>
		</html>
		`
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(htmlPath, html, 'utf8')
    const res = getAssetsFromHtml(htmlPath)
    const baseDir = path.join(tmp, 'root')
    expect(res.js).toEqual([path.join(baseDir, 'main.js')])
    expect(res.css).toEqual([path.join(baseDir, 'styles.css')])
    expect(res.static).toEqual(['/public/favicon.png', '/public/logo.png'])
  })

  it('collects <link> imagesrcset candidates as static assets', () => {
    const html = `
		<html>
		<head>
		  <link rel="preload" as="image" imagesrcset="hero.png 1x, hero-2x.png 2x">
		</head>
		<body></body>
		</html>
		`
    const dir = path.join(tmp, 'imgset')
    fs.mkdirSync(dir, {recursive: true})
    const htmlPath = path.join(dir, 'index.html')
    fs.writeFileSync(htmlPath, html, 'utf8')
    const res = getAssetsFromHtml(htmlPath)
    expect(res.static).toEqual([
      path.join(dir, 'hero.png'),
      path.join(dir, 'hero-2x.png')
    ])
  })

  it('collects video src and poster as distinct static assets', () => {
    const html = `
		<html>
		<body>
		  <video src="intro.mp4" poster="poster.jpg"></video>
		</body>
		</html>
		`
    const dir = path.join(tmp, 'video-poster')
    fs.mkdirSync(dir, {recursive: true})
    const htmlPath = path.join(dir, 'index.html')
    fs.writeFileSync(htmlPath, html, 'utf8')
    const res = getAssetsFromHtml(htmlPath)
    expect(res.static).toEqual([
      path.join(dir, 'intro.mp4'),
      path.join(dir, 'poster.jpg')
    ])
  })

  it('collects video poster when the movie is a child <source>', () => {
    const html = `
		<html>
		<body>
		  <video poster="poster.jpg">
		    <source src="intro.mp4" type="video/mp4">
		  </video>
		</body>
		</html>
		`
    const dir = path.join(tmp, 'video-source')
    fs.mkdirSync(dir, {recursive: true})
    const htmlPath = path.join(dir, 'index.html')
    fs.writeFileSync(htmlPath, html, 'utf8')
    const res = getAssetsFromHtml(htmlPath)
    expect(res.static).toEqual([
      path.join(dir, 'poster.jpg'),
      path.join(dir, 'intro.mp4')
    ])
  })

  it('collects img src plus every srcset candidate', () => {
    const html = `
		<html>
		<body>
		  <img src="hero.png" srcset="hero.png 1x, hero-2x.png 2x">
		</body>
		</html>
		`
    const dir = path.join(tmp, 'srcset')
    fs.mkdirSync(dir, {recursive: true})
    const htmlPath = path.join(dir, 'index.html')
    fs.writeFileSync(htmlPath, html, 'utf8')
    const res = getAssetsFromHtml(htmlPath)
    expect(res.static).toEqual([
      path.join(dir, 'hero.png'),
      path.join(dir, 'hero.png'),
      path.join(dir, 'hero-2x.png')
    ])
  })

  it('collects <source srcset> inside <picture> when there is no src', () => {
    const html = `
		<html>
		<body>
		  <picture>
		    <source type="image/webp" srcset="hero.webp">
		    <img src="hero.jpg">
		  </picture>
		</body>
		</html>
		`
    const dir = path.join(tmp, 'picture')
    fs.mkdirSync(dir, {recursive: true})
    const htmlPath = path.join(dir, 'index.html')
    fs.writeFileSync(htmlPath, html, 'utf8')
    const res = getAssetsFromHtml(htmlPath)
    expect(res.static).toEqual([
      path.join(dir, 'hero.webp'),
      path.join(dir, 'hero.jpg')
    ])
  })
})
