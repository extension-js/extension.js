import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {getAssetsFromHtml} from '../../html-lib/utils'

describe('getAssetsFromHtml', () => {
  const tmp = path.join(__dirname, '.tmp-utils')
  fs.mkdirSync(tmp, {recursive: true})

  it('returns empty when file missing', () => {
    const res = getAssetsFromHtml(path.join(tmp, 'missing.html'))
    expect(res).toEqual({css: [], js: [], static: []})
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
})
