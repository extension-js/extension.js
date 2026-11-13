import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, relPath: string, contents: string) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-unplaced-sheet-'))
  roots.push(root)

  write(
    root,
    'package.json',
    JSON.stringify({private: true, name: 'unplaced-sheet', version: '0.0.0'})
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'unplaced-sheet',
      version: '1.0.0',
      permissions: ['scripting'],
      host_permissions: ['https://sheet.example/*'],
      background: {service_worker: 'background.js'},
      action: {default_popup: 'popup/index.html'},
      content_scripts: [
        {matches: ['https://sheet.example/*'], js: ['content/side.js']},
        {matches: ['https://sheet.example/*'], js: ['content/value.js']},
        {matches: ['https://sheet.example/*'], js: ['content/module.js']},
        {matches: ['https://sheet.example/*'], js: ['content/query.js']},
        {matches: ['https://sheet.example/*'], js: ['content/shadow.js']},
        {
          matches: ['https://sheet.example/*'],
          js: ['content/main.js'],
          world: 'MAIN'
        },
        {matches: ['https://sheet.example/*'], js: ['content/library.js']}
      ]
    })
  )

  write(
    root,
    'background.js',
    "chrome.scripting.registerContentScripts([{id: 'hook', matches: ['https://sheet.example/*'], js: ['/scripts/hook.js']}])\n"
  )

  for (const sheet of [
    'side',
    'value',
    'query',
    'shadow',
    'main',
    'nested',
    'hook'
  ]) {
    write(root, `styles/${sheet}.css`, `.${sheet} { color: rgb(1, 2, 3) }\n`)
  }

  write(root, 'styles/scoped.module.css', '.scoped { color: rgb(4, 5, 6) }\n')
  write(root, 'styles/popup.css', '.popup { color: rgb(7, 8, 9) }\n')

  write(
    root,
    'content/side.js',
    "import '../styles/side.css'\nimport './nested.js'\n"
  )

  write(root, 'content/nested.js', "import '../styles/nested.css'\n")
  write(
    root,
    'content/value.js',
    "import href from '../styles/value.css'\nconst link = document.createElement('link')\nlink.rel = 'stylesheet'\nlink.href = href\ndocument.head.appendChild(link)\n"
  )

  write(
    root,
    'content/module.js',
    "import styles from '../styles/scoped.module.css'\ndocument.body.className = styles.scoped\n"
  )

  write(
    root,
    'content/query.js',
    "import href from '../styles/query.css?url'\nconsole.log(href)\n"
  )

  write(
    root,
    'content/shadow.js',
    "import '../styles/shadow.css'\nexport default function initial() {\n  const host = document.createElement('div')\n  host.setAttribute('data-extension-root', 'true')\n  document.body.appendChild(host)\n  host.attachShadow({mode: 'open'})\n  return () => host.remove()\n}\n"
  )

  write(root, 'content/main.js', "import '../styles/main.css'\n")
  write(root, 'content/library.js', "import 'styled-kit'\n")
  write(root, 'scripts/hook.js', "import '../styles/hook.css'\n")

  write(
    root,
    'node_modules/styled-kit/package.json',
    JSON.stringify({name: 'styled-kit', version: '1.0.0', main: 'index.js'})
  )

  write(
    root,
    'node_modules/styled-kit/index.js',
    "import './kit.css'\nexport const kit = true\n"
  )

  write(
    root,
    'node_modules/styled-kit/kit.css',
    '.kit { color: rgb(9, 9, 9) }\n'
  )

  write(
    root,
    'popup/index.html',
    '<!doctype html><html><head></head><body><script type="module" src="./popup.js"></script></body></html>\n'
  )

  write(root, 'popup/popup.js', "import '../styles/popup.css'\n")

  return root
}

async function build(root: string, mode: 'development' | 'production') {
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
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

describe('build: a content script imports a stylesheet for its side effect', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`${mode}: says so once per file, and only where nothing places the sheet`, async () => {
      const root = project()
      const summary = await build(root, mode)
      const unplaced = ((summary.warnings || []) as string[])
        .map((text) => text.replace(ANSI, ''))
        .filter((text) => text.includes('imported only for its side effect'))
      const named = unplaced.map((text) => /PATH (\S+)/.exec(text)?.[1]).sort()

      expect(summary.errors_count).toBe(0)
      expect(named).toEqual([
        'content/main.js:1',
        'content/nested.js:1',
        'content/side.js:1',
        'scripts/hook.js:1'
      ])

      const declared = unplaced.find((text) => text.includes('content/side.js'))
      const registered = unplaced.find((text) =>
        text.includes('scripts/hook.js')
      )

      expect(declared).toContain("IMPORT import '../styles/side.css'")
      expect(declared).toContain('content_scripts[].css')
      expect(registered).toContain("IMPORT import '../styles/hook.css'")
      expect(registered).not.toContain('content_scripts[].css')
    }, 120_000)
  }
})
