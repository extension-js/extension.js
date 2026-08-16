import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {discoverDevtoolsPanelPages} from '../discover-devtools-panels'

describe('discoverDevtoolsPanelPages', () => {
  const roots: string[] = []

  function makeProject(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-panels-'))
    roots.push(root)
    for (const [rel, contents] of Object.entries(files)) {
      const abs = path.join(root, rel)
      fs.mkdirSync(path.dirname(abs), {recursive: true})
      fs.writeFileSync(abs, contents)
    }
    return root
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('finds a panel page referenced from the devtools script', () => {
    const root = makeProject({
      'manifest.json': JSON.stringify({devtools_page: 'devtools.html'}),
      'devtools.html': '<script src="devtools.js"></script>',
      'devtools.js':
        'chrome.devtools.panels.create("P", "", "panel.html", function() {})',
      'panel.html': '<html></html>'
    })

    expect(
      discoverDevtoolsPanelPages(path.join(root, 'manifest.json'))
    ).toEqual({panel: path.join(root, 'panel.html')})
  })

  it('resolves nested panel paths against the extension root', () => {
    const root = makeProject({
      'manifest.json': JSON.stringify({
        devtools_page: 'devtools/devtools.html'
      }),
      'devtools/devtools.html': '<script src="devtools.js"></script>',
      'devtools/devtools.js':
        'chrome.devtools.panels.create("P", "", "devtools/panel/panel.html", cb)',
      'devtools/panel/panel.html': '<html></html>'
    })

    expect(
      discoverDevtoolsPanelPages(path.join(root, 'manifest.json'))
    ).toEqual({
      'devtools/panel/panel': path.join(root, 'devtools/panel/panel.html')
    })
  })

  it('follows relative imports and TypeScript source siblings', () => {
    const root = makeProject({
      'manifest.json': JSON.stringify({devtools_page: 'devtools.html'}),
      'devtools.html': '<script src="devtools.js"></script>',
      'devtools.ts': 'import "./register-panel"',
      'register-panel.ts':
        'chrome.devtools.panels.create("P", "", "panel.html", () => {})',
      'panel.html': '<html></html>'
    })

    expect(
      discoverDevtoolsPanelPages(path.join(root, 'manifest.json'))
    ).toEqual({panel: path.join(root, 'panel.html')})
  })

  it('ignores missing pages, non-html literals and escapes above the root', () => {
    const root = makeProject({
      'manifest.json': JSON.stringify({devtools_page: 'devtools.html'}),
      'devtools.html': '<script src="devtools.js"></script>',
      'devtools.js': [
        'chrome.devtools.panels.create("A", "", "missing.html", cb)',
        'chrome.devtools.panels.create("B", "", "panel.js", cb)',
        'chrome.devtools.panels.create("C", "", "../outside.html", cb)'
      ].join('\n'),
      'panel.js': ''
    })

    expect(
      discoverDevtoolsPanelPages(path.join(root, 'manifest.json'))
    ).toEqual({})
  })

  it('returns nothing without a devtools page', () => {
    const root = makeProject({
      'manifest.json': JSON.stringify({name: 'no devtools'})
    })
    expect(
      discoverDevtoolsPanelPages(path.join(root, 'manifest.json'))
    ).toEqual({})
  })
})
