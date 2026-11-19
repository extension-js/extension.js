import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterAll, afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadConfigResolvedHook,
  loadProjectConfigDefaults
} from '../config-loader'

// A config is read under the env files of the mode and browser that asked,
// whichever loader ran first, and runs again only when those files differ.
const KEY = 'EXTENSION_PUBLIC_STAGE'
const roots: string[] = []
let saved: string | undefined

beforeEach(() => {
  saved = process.env[KEY]
  delete process.env[KEY]
})

afterEach(() => {
  if (saved === undefined) delete process.env[KEY]
  else process.env[KEY] = saved
})

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>, type?: 'module') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-env-target-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'env-target',
      version: '0.0.0',
      ...(type ? {type} : {})
    })
  )

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content)
  }

  return root
}

const MODE_FILES = {
  '.env': `${KEY}=from-dotenv\n`,
  '.env.development': `${KEY}=from-development\n`,
  '.env.production': `${KEY}=from-production\n`
}

// Each run leaves one line behind, so the count of evaluations is on disk.
const CJS_BODY = `const seen = String(process.env.${KEY})
require('node:fs').appendFileSync(require('node:path').join(__dirname, 'runs.txt'), seen + '\\n')
module.exports = {
  perfBudgets: {seen},
  browser: {chrome: {profile: seen}},
  commands: {build: {profile: seen}, dev: {profile: seen}},
  configResolved: () => seen
}
`
const ESM_BODY = `import {appendFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const seen = String(process.env.${KEY})
appendFileSync(join(dirname(fileURLToPath(import.meta.url)), 'runs.txt'), seen + '\\n')

export default {
  perfBudgets: {seen},
  browser: {chrome: {profile: seen}},
  commands: {build: {profile: seen}, dev: {profile: seen}},
  configResolved: () => seen
}
`

const STYLES: Array<{
  name: string
  file: string
  body: string
  type?: 'module'
}> = [
  {name: 'a CommonJS .js config', file: 'extension.config.js', body: CJS_BODY},
  {name: 'a .cjs config', file: 'extension.config.cjs', body: CJS_BODY},
  {name: 'an .mjs config', file: 'extension.config.mjs', body: ESM_BODY},
  {
    name: 'an ES module .js config',
    file: 'extension.config.js',
    body: ESM_BODY,
    type: 'module'
  }
]

function runsOf(root: string): string[] {
  const file = path.join(root, 'runs.txt')
  if (!fs.existsSync(file)) return []

  return fs.readFileSync(file, 'utf-8').trim().split('\n')
}

type Seen = {profile?: string}

describe('a config is read for the mode and browser that asked', () => {
  for (const style of STYLES) {
    it(`gives dev its own env files after a loader that named no mode, in ${style.name}`, async () => {
      const root = project(
        {...MODE_FILES, [style.file]: style.body},
        style.type
      )

      const browser = (await loadBrowserConfig(root, 'chrome')) as Seen
      const dev = (await loadCommandConfig(root, 'dev')) as Seen

      expect(browser.profile).toBe('from-production')
      expect(dev.profile).toBe('from-development')
      expect(runsOf(root)).toEqual(['from-production', 'from-development'])
    })
  }

  it('reads a loader that names no mode the way the run last read the config', async () => {
    const root = project({...MODE_FILES, 'extension.config.js': CJS_BODY})

    const dev = (await loadCommandConfig(root, 'dev')) as Seen
    const defaults = (await loadProjectConfigDefaults(root)) as {
      perfBudgets?: {seen?: string}
    }
    const browser = (await loadBrowserConfig(root, 'chrome')) as Seen
    const hook = (await loadConfigResolvedHook(root)) as unknown as () => string

    expect(dev.profile).toBe('from-development')
    expect(defaults.perfBudgets?.seen).toBe('from-development')
    expect(browser.profile).toBe('from-development')
    expect(hook()).toBe('from-development')
    expect(runsOf(root)).toEqual(['from-development'])
    expect(process.env[KEY]).toBe('from-development')
  })

  it('gives a named browser its own env file after a load that named none', async () => {
    const root = project({
      ...MODE_FILES,
      '.env.firefox': `${KEY}=from-firefox\n`,
      'extension.config.js': CJS_BODY
    })

    const build = (await loadCommandConfig(root, 'build')) as Seen
    const firefox = (await loadProjectConfigDefaults(root, {
      mode: 'production',
      browser: 'firefox'
    })) as {perfBudgets?: {seen?: string}}
    const chrome = (await loadProjectConfigDefaults(root, {
      mode: 'production',
      browser: 'chrome'
    })) as {perfBudgets?: {seen?: string}}

    expect(build.profile).toBe('from-production')
    expect(firefox.perfBudgets?.seen).toBe('from-firefox')
    expect(chrome.perfBudgets?.seen).toBe('from-production')

    // Chrome has no file of its own here, so it is the first run's answer.
    expect(runsOf(root)).toEqual(['from-production', 'from-firefox'])
    expect(process.env[KEY]).toBe('from-production')
  })

  it('runs the config once when the mode and browser change no env value', async () => {
    const root = project({
      '.env': `${KEY}=from-dotenv\n`,
      'extension.config.js': CJS_BODY
    })

    await loadCommandConfig(root, 'dev')
    await loadCommandConfig(root, 'build')
    await loadProjectConfigDefaults(root, {
      mode: 'production',
      browser: 'firefox'
    })

    await Promise.all([
      loadBrowserConfig(root, 'chrome'),
      loadCommandConfig(root, 'dev', {browser: 'chrome'})
    ])

    expect(runsOf(root)).toEqual(['from-dotenv'])
  })
})

// Vitest loads a config through its own module runner. Plain Node keeps a
// module it already ran, so the built package in a child is the real test.
describe('a config read for two modes, under plain Node', () => {
  const builtModule = path.resolve(__dirname, '..', '..', 'dist', 'module.mjs')

  it('has the built package to run', () => {
    expect(fs.existsSync(builtModule)).toBe(true)
  })

  for (const style of STYLES) {
    it(`reads ${style.name} once for build and once for dev`, () => {
      const root = project(
        {...MODE_FILES, [style.file]: style.body},
        style.type
      )
      const scriptPath = path.join(root, 'run.mjs')

      // A script file, because --eval exposes node:module as a global named
      // module, which a CommonJS config would then assign its exports onto.
      fs.writeFileSync(
        scriptPath,
        `
import {loadCommandConfig} from ${JSON.stringify(pathToFileURL(builtModule).href)}

const root = ${JSON.stringify(root)}
const build = await loadCommandConfig(root, 'build')
const dev = await loadCommandConfig(root, 'dev')
const again = await loadCommandConfig(root, 'build')
process.stdout.write('RESULT:' + JSON.stringify([build.profile, dev.profile, again.profile]))
`
      )

      const {[KEY]: _dropped, ...env} = process.env
      const run = spawnSync(process.execPath, [scriptPath], {
        encoding: 'utf-8',
        env
      })

      expect(run.stderr).toBe('')
      expect(JSON.parse(run.stdout.split('RESULT:')[1] || 'null')).toEqual([
        'from-production',
        'from-development',
        'from-production'
      ])

      expect(runsOf(root)).toEqual(['from-production', 'from-development'])
    })
  }
})
