import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {getAssetsFromHtml} from '../../html-lib/utils'

describe('getAssetsFromHtml', () => {
  const tmp = path.join(__dirname, '.tmp-utils')
  fs.mkdirSync(tmp, {recursive: true})

  it('returns empty when file missing', () => {
    const res = getAssetsFromHtml(path.join(tmp, 'missing.html'))
    expect(res).toEqual({css: [], js: [], moduleJs: [], static: []})
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
})
