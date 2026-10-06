import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

function resolveSass(): string | undefined {
  let dir = __dirname

  while (true) {
    const candidate = path.join(dir, 'node_modules', 'sass')
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate

    const parent = path.dirname(dir)
    if (parent === dir) return undefined

    dir = parent
  }
}

const sassDir = resolveSass()

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
})
