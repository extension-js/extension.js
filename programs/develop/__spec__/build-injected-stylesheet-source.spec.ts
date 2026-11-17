import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {workspacePackage} from './helpers/workspace-package'

const roots: string[] = []

const sassDir = workspacePackage('sass')

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-injected-style-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'injected-style',
      version: '0.0.0',
      devDependencies: {sass: '*'}
    })
  )

  fs.mkdirSync(path.join(root, 'node_modules'), {recursive: true})
  fs.symlinkSync(
    sassDir as string,
    path.join(root, 'node_modules', 'sass'),
    'dir'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'injected-style',
      version: '1.0.0',
      permissions: ['scripting', 'activeTab'],
      action: {},
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    [
      'chrome.action.onClicked.addListener((tab) => {',
      "  chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['inject/run.js']})",
      "  chrome.scripting.insertCSS({target: {tabId: tab.id}, files: ['inject/look.css']})",
      '})',
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

async function build(root: string, mode: 'production' | 'development') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as never)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function listDist(root: string): string[] {
  const dist = path.join(root, 'dist', 'chrome')
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

describe('a stylesheet injected by its css name', () => {
  it.skipIf(!sassDir)(
    'is compiled from its scss source the way an injected ts is',
    async () => {
      const root = project({
        'inject/run.ts':
          'const mark: string = "INJECT_RUN_2c7e"\ndocument.title = mark\n',
        'inject/look.scss': '$c: red;\n.injected-look-2c7e { color: $c; }\n'
      })

      for (const mode of ['production', 'development'] as const) {
        const summary = await build(root, mode)

        expect(summary.errors_count, mode).toBe(0)
        expect(summary.warnings_count, mode).toBe(0)

        const files = listDist(root).filter((file) => !file.endsWith('.map'))

        expect(files, mode).toEqual([
          'background/service_worker.js',
          'inject/look.css',
          'inject/run.js',
          'manifest.json'
        ])

        const css = fs.readFileSync(
          path.join(root, 'dist', 'chrome', 'inject', 'look.css'),
          'utf8'
        )

        expect(css, mode).toContain('.injected-look-2c7e')
        expect(css, mode).toContain('red')
        expect(css, mode).not.toContain('$c')
        expect(
          fs.readFileSync(
            path.join(root, 'dist', 'chrome', 'inject', 'run.js'),
            'utf8'
          ),
          mode
        ).toContain('INJECT_RUN_2c7e')
      }
    },
    120_000
  )

  // A page fetches what an injected sheet loads, so a file the compiler
  // emits for the sheet is listed the way a copied sheet's files are.
  it.skipIf(!sassDir)(
    'lets a page fetch the asset its scss source names',
    async () => {
      const root = project({
        'inject/run.ts': 'document.title = "run"\n',
        'inject/look.scss':
          '$size: 16px;\n.injected-look-7d3a { width: $size; background: url("img/large.png"); }\n',
        // Past the size the bundler would inline as a data: URL.
        'inject/img/large.png': 'p'.repeat(40_000)
      })
      const summary = await build(root, 'production')

      expect(summary.errors_count).toBe(0)

      const emitted = listDist(root).filter((file) =>
        /^assets\/large\.[0-9a-f]+\.png$/.test(file)
      )
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, 'dist/chrome/manifest.json'), 'utf8')
      )

      expect(emitted).toHaveLength(1)
      expect(
        fs.readFileSync(path.join(root, 'dist/chrome/inject/look.css'), 'utf8')
      ).toContain(
        `url("chrome-extension://__MSG_@@extension_id__/${emitted[0]}")`
      )

      expect(manifest.web_accessible_resources).toEqual([
        {resources: emitted, matches: ['<all_urls>']}
      ])

      // The one line that says the file is now open to every page.
      expect(summary.warnings_count).toBe(1)
      expect((summary.warnings || [])[0]).toContain('inject/look.css')
      expect((summary.warnings || [])[0]).toContain(emitted[0])
    },
    120_000
  )
})
