import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {workspacePackage} from './helpers/workspace-package'
import {trackTempFolders} from './helpers/temp-folders'

type Browser = 'chrome' | 'firefox' | 'safari'

const tempFolder = trackTempFolders()

const sassDir = workspacePackage('sass')

function project(files: Record<string, string>, sass = false) {
  const root = tempFolder('extjs-sheet-listing-')

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'sheet-listing',
      version: '0.0.0',
      ...(sass ? {devDependencies: {sass: '*'}} : {})
    })
  )

  if (sass) {
    fs.mkdirSync(path.join(root, 'node_modules'), {recursive: true})
    fs.symlinkSync(
      sassDir as string,
      path.join(root, 'node_modules', 'sass'),
      'dir'
    )
  }

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'sheet-listing',
      version: '1.0.0',
      permissions: ['scripting', 'activeTab'],
      action: {},
      background: {service_worker: 'background.js', scripts: ['background.js']}
    })
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    [
      'chrome.action.onClicked.addListener((tab) =>',
      '  chrome.scripting.insertCSS({target: {tabId: tab.id}, files: ["styles/inject.css"]}))',
      ''
    ].join('\n')
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string, browser: Browser) {
  return buildProject(root, {
    browser,
    mode: 'production'
  })
}

// Every path the built manifest lets a page fetch, whichever shape it has.
function listed(root: string, browser: Browser): string[] {
  const groups: Array<string | {resources?: string[]}> =
    JSON.parse(
      fs.readFileSync(path.join(root, 'dist', browser, 'manifest.json'), 'utf8')
    ).web_accessible_resources || []

  return groups
    .flatMap((group) =>
      typeof group === 'string' ? [group] : group.resources || []
    )
    .sort()
}

function shipped(root: string, browser: Browser): string[] {
  const dist = path.join(root, 'dist', browser)
  const out: string[] = []

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else out.push(path.relative(dist, abs).split(path.sep).join('/'))
    }
  }

  walk(dist)

  return out.sort()
}

// Firefox loads an image an injected sheet names without an entry and
// refuses its font without one. Every other target needs each file listed.
const BROWSERS: Browser[] = ['chrome', 'firefox', 'safari']

describe('the files an injected sheet loads, by target', () => {
  it.each(
    BROWSERS
  )('lists what a sheet it imports names, on %s', async (browser) => {
    const root = project({
      'styles/inject.css': '@import "base.css";\nbody { color: red; }\n',
      'styles/base.css': [
        '@font-face { font-family: "Imported"; src: url("../fonts/b.woff2"); }',
        '.base { background: url("img/base.png"); }',
        ''
      ].join('\n'),
      'styles/img/base.png': 'png',
      'fonts/b.woff2': 'font'
    })
    const summary = await build(root, browser)

    expect(summary.errors_count).toBe(0)
    expect(shipped(root, browser)).toEqual(
      expect.arrayContaining(['fonts/b.woff2', 'styles/img/base.png'])
    )

    expect(listed(root, browser)).toEqual(
      browser === 'firefox'
        ? ['fonts/b.woff2']
        : ['fonts/b.woff2', 'styles/img/base.png']
    )
  }, 120_000)

  it.skipIf(!sassDir).each(BROWSERS)(
    'lists what a compiled sheet emits, on %s',
    async (browser) => {
      const root = project(
        {
          'styles/inject.scss': [
            '$family: "Compiled";',
            '@font-face { font-family: $family; src: url("fonts/c.woff2"); }',
            '.compiled { background: url("img/large.png"); }',
            ''
          ].join('\n'),
          // Past the size the bundler would inline as a data: URL.
          'styles/img/large.png': 'p'.repeat(40_000),
          'styles/fonts/c.woff2': 'f'.repeat(40_000)
        },
        true
      )
      const summary = await build(root, browser)

      expect(summary.errors_count).toBe(0)

      const files = shipped(root, browser)
      const font = files.filter((file) => /\/c\.[0-9a-f]+\.woff2$/.test(file))
      const image = files.filter((file) =>
        /\/large\.[0-9a-f]+\.png$/.test(file)
      )

      expect(font).toHaveLength(1)
      expect(image).toHaveLength(1)

      expect(listed(root, browser)).toEqual(
        browser === 'firefox' ? font : [...font, ...image].sort()
      )
    },
    120_000
  )
})
