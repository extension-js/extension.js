import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, describe, expect, it} from 'vitest'
import {stripAnsi} from '../dev-server/lifecycle-stream'

// Production module ids are a hash of each module's full identifier, loader
// paths included. extension-develop is reached through a symlink here, the
// way `npm link` and pnpm lay it out, so without the project-local naming
// the loader paths (and the ids) depend on how deep the project folder sits.
const DEVELOP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(...nested: string[]) {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'extjs-ids-'))
  )
  roots.push(base)
  const root = path.join(base, ...nested, 'project')

  fs.mkdirSync(path.join(root, 'src'), {recursive: true})
  fs.mkdirSync(path.join(root, 'popup'), {recursive: true})
  fs.mkdirSync(path.join(root, 'node_modules'), {recursive: true})
  fs.symlinkSync(
    DEVELOP_ROOT,
    path.join(root, 'node_modules', 'extension-develop'),
    'dir'
  )

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'ids', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'ids',
      version: '1.0.0',
      background: {service_worker: 'src/background.ts'},
      action: {default_popup: 'popup/index.html'},
      content_scripts: [
        {
          matches: ['https://example.com/*'],
          js: ['src/content.ts'],
          css: ['src/content.css']
        }
      ]
    })
  )

  fs.writeFileSync(
    path.join(root, 'src', 'shared.ts'),
    "export const label = (name: string) => 'ids:' + name\n"
  )

  fs.writeFileSync(
    path.join(root, 'src', 'background.ts'),
    "import {label} from './shared'\nconsole.log(label('background'))\n"
  )

  fs.writeFileSync(
    path.join(root, 'src', 'content.ts'),
    "import {label} from './shared'\nimport './veil.css'\ndocument.documentElement.dataset.ids = label('content')\n"
  )

  fs.writeFileSync(path.join(root, 'src', 'veil.css'), 'html{opacity:.99}\n')
  fs.writeFileSync(
    path.join(root, 'src', 'content.css'),
    'html{outline:1px solid tomato}\n'
  )

  fs.writeFileSync(
    path.join(root, 'popup', 'index.html'),
    '<!doctype html><title>ids</title><link rel="stylesheet" href="./styles.css" /><script src="./scripts.ts" type="module"></script>'
  )

  fs.writeFileSync(path.join(root, 'popup', 'styles.css'), 'body{margin:0}\n')
  fs.writeFileSync(
    path.join(root, 'popup', 'scripts.ts'),
    "import {label} from '../src/shared'\ndocument.title = label('popup')\n"
  )

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => lines.push(args.join(' '))

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)

    return {summary, output: stripAnsi(lines.join('\n'))}
  } finally {
    console.log = originalLog
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function bundles(root: string): Record<string, string> {
  const dist = path.join(root, 'dist', 'chrome')
  const files: Record<string, string> = {}

  for (const entry of fs.readdirSync(dist, {
    recursive: true,
    withFileTypes: true
  })) {
    if (!entry.isFile() || !/\.(js|css)$/.test(entry.name)) continue

    const file = path.join(entry.parentPath, entry.name)
    files[path.relative(dist, file).split(path.sep).join('/')] =
      fs.readFileSync(file, 'utf8')
  }

  return files
}

describe('reproducible production module ids', () => {
  it('emits the same bundle bytes from two folders of different depth', async () => {
    const shallow = project()
    const deep = project('one', 'two', 'three')

    const first = await build(shallow)
    const second = await build(deep)

    const shallowBundles = bundles(shallow)
    const deepBundles = bundles(deep)

    expect(Object.keys(shallowBundles).sort()).toEqual([
      'action/index.css',
      'action/index.js',
      'background/service_worker.js',
      'content_scripts/content-0.css',
      'content_scripts/content-0.js'
    ])

    expect(Object.keys(deepBundles).sort()).toEqual(
      Object.keys(shallowBundles).sort()
    )

    for (const name of Object.keys(shallowBundles)) {
      expect(deepBundles[name], name).toBe(shallowBundles[name])
    }

    // The content bundle keeps its stylesheet as a module with a numeric id
    // (the wrapper loads it at runtime), so the comparison above covered one.
    expect(shallowBundles['content_scripts/content-0.js']).toMatch(/[{,]\d+\(/)

    expect(first.summary.toolchain?.node).toBe(process.version)
    expect(second.summary.toolchain).toEqual(first.summary.toolchain)
    expect(first.output).toContain(`Built with Node ${process.version}`)
  }, 90_000)
})
