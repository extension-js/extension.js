import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'
import {writeProjectFiles} from './helpers/extension-project'

const tempFolder = trackTempFolders()

const STRICT_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'"

function project(manifest: Record<string, unknown> = {}) {
  const root = tempFolder('extjs-dialog-floor-')

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'dialog-floor',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'dialog-floor',
      version: '1.0.0',
      options_ui: {page: 'options.html'},
      action: {default_popup: 'popup.html'},
      content_security_policy: {extension_pages: STRICT_POLICY},
      ...manifest
    }),
    'options.html':
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="options.css"></head>' +
      '<body><div id="root"></div><script src="options.js"></script></body></html>\n',
    'options.css': 'body { margin: 0 }\n',
    'options.js': 'console.log("options")\n',
    'popup.html':
      '<!doctype html><html><head></head>' +
      '<body><script src="popup.js"></script></body></html>\n',
    'popup.js': 'console.log("popup")\n'
  }

  writeProjectFiles(root, files)

  return root
}

async function build(
  root: string,
  browser: 'chrome' | 'firefox' = 'chrome',
  mode: 'production' | 'development' = 'production'
) {
  return buildProject(root, {
    browser,
    mode
  })
}

function dist(root: string, rel: string, browser = 'chrome') {
  return path.join(root, 'dist', browser, rel)
}

function htmlPages(root: string, browser = 'chrome') {
  return (
    fs.readdirSync(dist(root, '.', browser), {recursive: true}) as string[]
  )
    .map((entry) => String(entry).split(path.sep).join('/'))
    .filter((entry) => entry.endsWith('.html'))
    .sort()
}

// What a policy of style-src 'self' and script-src 'self' blocks: a style
// tag, a style attribute and a script with no src.
function inlineCode(html: string): string[] {
  return [
    ...(html.match(/<style\b[^>]*>/gi) || []),
    ...(html.match(/<[a-z][^>]*\sstyle\s*=/gi) || []),
    ...(html.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*>/gi) || [])
  ]
}

describe('the options dialog floor under a strict extension policy', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`ships as a linked stylesheet in ${mode}`, async () => {
      const root = project()
      await build(root, 'chrome', mode)

      const options = fs.readFileSync(dist(root, 'options/index.html'), 'utf8')

      expect(options).toContain(
        '<head><link rel="stylesheet" href="/options/dialog-floor.css" data-extension-js="options-dialog-floor">'
      )

      // The floor comes first, so the page's own sheet still wins.
      expect(options.indexOf('/options/dialog-floor.css')).toBeLessThan(
        options.indexOf('/options/index.css')
      )

      expect(
        fs.readFileSync(dist(root, 'options/dialog-floor.css'), 'utf8')
      ).toBe('html{min-height:32px}')
    }, 180_000)
  }

  for (const mode of ['production', 'development'] as const) {
    it(`puts no inline style or script into a page it builds in ${mode}`, async () => {
      const root = project()
      await build(root, 'chrome', mode)

      expect(htmlPages(root)).toEqual([
        'action/index.html',
        'options/index.html'
      ])

      for (const page of htmlPages(root)) {
        expect(
          inlineCode(fs.readFileSync(dist(root, page), 'utf8')),
          page
        ).toEqual([])
      }
    }, 180_000)
  }

  it('ships no floor for a page that opens in a tab or for Firefox', async () => {
    const inTab = project({
      options_ui: {page: 'options.html', open_in_tab: true}
    })
    await build(inTab)

    expect(
      fs.readFileSync(dist(inTab, 'options/index.html'), 'utf8')
    ).not.toContain('dialog-floor')

    expect(fs.existsSync(dist(inTab, 'options/dialog-floor.css'))).toBe(false)

    const gecko = project({
      browser_specific_settings: {gecko: {id: 'dialog-floor@example.com'}}
    })
    await build(gecko, 'firefox')

    expect(
      fs.readFileSync(dist(gecko, 'options/index.html', 'firefox'), 'utf8')
    ).not.toContain('dialog-floor')

    expect(
      fs.existsSync(dist(gecko, 'options/dialog-floor.css', 'firefox'))
    ).toBe(false)
  }, 180_000)
})
