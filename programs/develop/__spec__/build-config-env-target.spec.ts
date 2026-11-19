import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'

// The config and the bundle of one build read the same env files: the ones
// for the mode and the browser the build runs for.
const tempFolder = trackTempFolders()
const KEYS = [
  'EXTENSION_PUBLIC_MODE_STAGE',
  'EXTENSION_PUBLIC_BROWSER_STAGE',
  'EXTENSION_PUBLIC_NAMED_STAGE'
]

afterEach(() => {
  vi.restoreAllMocks()

  for (const key of KEYS) delete process.env[key]
})

// The config writes down each time it runs and what it read while loading.
const config = (key: string, more = '') =>
  "const fs = require('node:fs')\n" +
  "const path = require('node:path')\n" +
  `const seen = String(process.env.${key})\n` +
  "fs.appendFileSync(path.join(__dirname, 'config-runs.log'), seen + '\\n')\n" +
  `module.exports = {${more}}\n`

function project(key: string, files: Record<string, string>) {
  const root = fs.realpathSync(tempFolder('extjs-config-env-'))

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'config-env',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'config-env',
      version: '1.0.0',
      background: {service_worker: 'background.js', scripts: ['background.js']}
    }),
    'background.js': `console.log('bundle read', process.env.${key})\n`,
    ...files
  }

  for (const [file, text] of Object.entries(all)) {
    fs.writeFileSync(path.join(root, file), text)
  }

  return root
}

async function build(root: string, options: Record<string, unknown>) {
  const {extensionBuild} = await import('../command-build')

  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {})
  }

  const summary = await extensionBuild(root, {
    install: false,
    silent: true,
    ...options
  } as never)

  const dist = path.join(root, 'dist', String(summary.browser))
  const bundle = fs
    .readdirSync(dist, {recursive: true})
    .map(String)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(dist, file), 'utf8'))
    .join('\n')

  return {
    bundle,
    configRuns: fs
      .readFileSync(path.join(root, 'config-runs.log'), 'utf8')
      .trim()
      .split('\n')
  }
}

describe('build: the config reads the env files of the running build (real rspack)', () => {
  it('reads .env.development under --mode development, once', async () => {
    const key = 'EXTENSION_PUBLIC_MODE_STAGE'
    const root = project(key, {
      '.env.development': `${key}=from-development\n`,
      '.env.production': `${key}=from-production\n`,
      'extension.config.js': config(key)
    })

    const built = await build(root, {browser: 'chrome', mode: 'development'})

    expect(built.configRuns).toEqual(['from-development'])
    expect(built.bundle).toContain('from-development')
    expect(built.bundle).not.toContain('from-production')
  }, 120_000)

  it('reads the env file of the browser the build was asked for, once', async () => {
    const key = 'EXTENSION_PUBLIC_BROWSER_STAGE'
    const root = project(key, {
      '.env.firefox': `${key}=from-firefox\n`,
      '.env.production': `${key}=from-production\n`,
      'extension.config.js': config(key)
    })

    const built = await build(root, {browser: 'firefox', mode: 'production'})

    expect(built.configRuns).toEqual(['from-firefox'])
    expect(built.bundle).toContain('from-firefox')
    expect(built.bundle).not.toContain('from-production')
  }, 120_000)

  // The config has to run to name the browser, so it runs for the mode
  // first and once more with the file of the browser it named.
  it('runs again for the browser when the config itself names it', async () => {
    const key = 'EXTENSION_PUBLIC_NAMED_STAGE'
    const root = project(key, {
      '.env.firefox': `${key}=from-firefox\n`,
      '.env.development': `${key}=from-development\n`,
      '.env.production': `${key}=from-production\n`,
      'extension.config.js': config(
        key,
        "commands: {build: {browser: 'firefox'}}"
      )
    })

    const built = await build(root, {mode: 'development'})

    expect(built.configRuns).toEqual(['from-development', 'from-firefox'])
    expect(built.bundle).toContain('from-firefox')
  }, 120_000)
})
