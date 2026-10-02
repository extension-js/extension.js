import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it} from 'vitest'
import {loadCommandConfig} from '../config-loader'
import {configLoadingError} from '../messages'

const KEYS = ['MY_CFG_VALUE', 'EXTENSION_PUBLIC_A']
const roots: string[] = []
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cfg-identity-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'cfg-identity', version: '0.0.0'})
  )

  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents, 'utf-8')
  }

  return root
}

describe('a config that reads import.meta.env keeps its own module identity', () => {
  it('resolves a relative sibling import', async () => {
    const root = project({
      '.env': 'MY_CFG_VALUE=hello-from-env\n',
      'shared.mjs': "export const SUFFIX = '-with-sibling'\n",
      'extension.config.mjs': `
import {SUFFIX} from './shared.mjs'

export default {
  commands: {
    build: {profile: String(import.meta.env.MY_CFG_VALUE) + SUFFIX}
  }
}
`.trimStart()
    })

    const config = (await loadCommandConfig(root, 'build')) as {
      profile?: string
    }
    expect(config.profile).toBe('hello-from-env-with-sibling')
  })

  it('reports import.meta.dirname and import.meta.url for the real file', async () => {
    const root = project({
      '.env': 'MY_CFG_VALUE=hello-from-env\n',
      'extension.config.mjs': `
export default {
  commands: {
    build: {
      profile: import.meta.dirname,
      startingUrl: import.meta.url
    }
  },
  define: {__FLAG__: JSON.stringify(String(import.meta.env.MY_CFG_VALUE))}
}
`.trimStart()
    })

    const config = (await loadCommandConfig(root, 'build')) as {
      profile?: string
      startingUrl?: string
    }

    expect(fs.realpathSync(String(config.profile))).toBe(fs.realpathSync(root))
    expect(config.startingUrl).toContain('extension.config.mjs')
    expect(config.startingUrl).not.toContain('extension-config-esm')
  })

  it('still reads the env value when the config has no relative import', async () => {
    const root = project({
      '.env': 'MY_CFG_VALUE=plain\n',
      'extension.config.mjs': `
export default {
  commands: {build: {profile: String(import.meta.env.MY_CFG_VALUE)}}
}
`.trimStart()
    })

    const config = (await loadCommandConfig(root, 'build')) as {
      profile?: string
    }
    expect(config.profile).toBe('plain')
  })

  it('leaves a config that never mentions import.meta.env alone', async () => {
    const root = project({
      'shared.mjs': "export const VALUE = 'untouched'\n",
      'extension.config.mjs': `
import {VALUE} from './shared.mjs'

export default {commands: {build: {profile: VALUE}}}
`.trimStart()
    })

    const config = (await loadCommandConfig(root, 'build')) as {
      profile?: string
    }
    expect(config.profile).toBe('untouched')
  })
})

describe('the config loading frame says why it failed', () => {
  it('shows an Error message instead of an empty object', () => {
    const frame = configLoadingError(
      '/p/extension.config.js',
      new Error('boom from config')
    )

    expect(frame).toContain('boom from config')
    expect(frame).not.toContain('{}')
  })

  it.each([
    ['a thrown string', 'plain string failure', 'plain string failure'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null']
  ])('shows %s rather than an empty object', (_label, thrown, expected) => {
    const frame = configLoadingError('/p/extension.config.js', thrown)

    expect(frame).toContain(expected)
    expect(frame).not.toContain('{}')
  })

  it('falls back to the name when an Error carries no message', () => {
    const bare = new Error('')
    bare.name = 'SyntaxError'

    expect(configLoadingError('/p/extension.config.js', bare)).toContain(
      'SyntaxError'
    )
  })
})

describe('a config file must export an object', () => {
  const cases: Array<{name: string; source: string; found: string}> = [
    {
      name: 'a function',
      source: 'export default (config) => config\n',
      found: 'a function'
    },
    {name: 'an array', source: 'export default []\n', found: 'an array'},
    {name: 'a string', source: 'export default "nope"\n', found: 'a string'},
    {name: 'null', source: 'export default null\n', found: 'null'}
  ]

  it.each(cases)('refuses $name by naming the shape', async ({
    source,
    found
  }) => {
    const root = project({'extension.config.mjs': source})
    const error = await loadCommandConfig(root, 'build').then(
      () => null,
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain(
      `must export an object, found ${found}`
    )

    expect(String((error as Error).message)).toContain('extension.config')
  })

  it('suggests the wrapper form for a function export', async () => {
    const root = project({
      'extension.config.mjs': 'export default (config) => config\n'
    })
    const error = await loadCommandConfig(root, 'build').then(
      () => null,
      (reason: unknown) => reason
    )

    expect(String((error as Error).message)).toContain(
      'config: (config) => config'
    )
  })

  it('accepts the wrapper form it suggests', async () => {
    const root = project({
      'extension.config.mjs': `
export default {
  config: (config) => config,
  commands: {build: {profile: 'wrapped'}}
}
`.trimStart()
    })

    const config = (await loadCommandConfig(root, 'build')) as {
      profile?: string
    }
    expect(config.profile).toBe('wrapped')
  })
})
