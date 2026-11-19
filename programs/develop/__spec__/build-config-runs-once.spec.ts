import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'

// A config that names the browser runs before the browser's env files are
// known. It runs again only when those files change a name it read.
const tempFolder = trackTempFolders()
const KEYS = ['EXTENSION_PUBLIC_RUNS_STAGE', 'EXTENSION_PUBLIC_RUNS_OTHER']

afterEach(() => {
  vi.restoreAllMocks()

  for (const key of KEYS) delete process.env[key]
})

// The config writes down each time it runs and, when it reads one, the value.
const config = (read?: string) =>
  "const fs = require('node:fs')\n" +
  "const path = require('node:path')\n" +
  `const seen = ${read ? `String(process.env.${read})` : "'ran'"}\n` +
  "fs.appendFileSync(path.join(__dirname, 'config-runs.log'), seen + '\\n')\n" +
  "module.exports = {commands: {build: {browser: 'firefox'}}}\n"

function project(files: Record<string, string>) {
  const root = fs.realpathSync(tempFolder('extjs-config-runs-'))

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'config-runs',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'config-runs',
      version: '1.0.0',
      background: {service_worker: 'background.js', scripts: ['background.js']}
    }),
    'background.js':
      "console.log('bundle read', process.env.EXTENSION_PUBLIC_RUNS_STAGE)\n",
    '.env.firefox': 'EXTENSION_PUBLIC_RUNS_STAGE=from-firefox\n',
    '.env.production': [
      'EXTENSION_PUBLIC_RUNS_STAGE=from-production',
      'EXTENSION_PUBLIC_RUNS_OTHER=same-everywhere',
      ''
    ].join('\n'),
    ...files
  }

  for (const [file, text] of Object.entries(all)) {
    fs.writeFileSync(path.join(root, file), text)
  }

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')

  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {})
  }

  const summary = await extensionBuild(root, {
    install: false,
    silent: true
  } as never)

  const dist = path.join(root, 'dist', String(summary.browser))
  const bundle = fs
    .readdirSync(dist, {recursive: true})
    .map(String)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(dist, file), 'utf8'))
    .join('\n')

  return {
    browser: summary.browser,
    bundle,
    configRuns: fs
      .readFileSync(path.join(root, 'config-runs.log'), 'utf8')
      .trim()
      .split('\n')
  }
}

describe('build: a config that names the browser runs as often as it must (real rspack)', () => {
  it('runs once when it reads no name the browser env file changes', async () => {
    const root = project({'extension.config.js': config()})

    const built = await build(root)

    expect(built.browser).toBe('firefox')
    expect(built.configRuns).toEqual(['ran'])
    expect(built.bundle).toContain('from-firefox')
    expect(built.bundle).not.toContain('from-production')
  }, 120_000)

  it('runs once when the name it reads holds the same value for the browser', async () => {
    const root = project({
      'extension.config.js': config('EXTENSION_PUBLIC_RUNS_OTHER')
    })

    const built = await build(root)

    expect(built.configRuns).toEqual(['same-everywhere'])
    expect(built.bundle).toContain('from-firefox')
  }, 120_000)

  it('runs again and sees the browser value when it reads a name that file changes', async () => {
    const root = project({
      'extension.config.js': config('EXTENSION_PUBLIC_RUNS_STAGE')
    })

    const built = await build(root)

    expect(built.configRuns).toEqual(['from-production', 'from-firefox'])
    expect(built.bundle).toContain('from-firefox')
    expect(built.bundle).not.toContain('from-production')
  }, 120_000)
})
