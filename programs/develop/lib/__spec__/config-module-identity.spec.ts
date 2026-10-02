import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {loadCommandConfig, loadCustomConfig} from '../config-loader'
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

// Vitest compiles a config it imports and fills in import.meta.env itself, so
// the cases above pass without the loader hook. Plain Node has no such
// property, which makes the built package in a child process the real test.
describe('import.meta.env in a config, under plain Node', () => {
  const builtModule = path.resolve(__dirname, '..', '..', 'dist', 'module.mjs')

  function loadBuildCommandConfig(root: string) {
    const script = `
import {loadCommandConfig} from ${JSON.stringify(pathToFileURL(builtModule).href)}

const config = await loadCommandConfig(${JSON.stringify(root)}, 'build')
process.stdout.write('RESULT:' + JSON.stringify(config))
`

    const {MY_CFG_VALUE: _dropped, ...env} = process.env
    const run = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', script],
      {encoding: 'utf-8', env}
    )

    return {
      status: run.status,
      output: `${run.stdout}\n${run.stderr}`,
      config: JSON.parse(run.stdout.split('RESULT:')[1] || 'null') as {
        profile?: string
      } | null
    }
  }

  it('has the built package to run', () => {
    expect(fs.existsSync(builtModule)).toBe(true)
  })

  it('reads a dotenv value through import.meta.env beside a relative import', () => {
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

    const run = loadBuildCommandConfig(root)

    expect(run.output).not.toContain('Cannot read properties of undefined')
    expect(run.status).toBe(0)
    expect(run.config?.profile).toBe('hello-from-env-with-sibling')
  })

  it('loads a config that never mentions import.meta.env the same way', () => {
    const root = project({
      'extension.config.mjs':
        "export default {commands: {build: {profile: 'untouched'}}}\n"
    })

    const run = loadBuildCommandConfig(root)

    expect(run.status).toBe(0)
    expect(run.config?.profile).toBe('untouched')
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

  it('leaves the refusal to the command, which prints it once', async () => {
    const root = project({
      'extension.config.mjs': 'export default (config) => config\n'
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      for (const load of [
        () => loadCustomConfig(root),
        () => loadCommandConfig(root, 'build')
      ]) {
        await expect(load()).rejects.toThrow(/must export an object/)
      }

      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('still frames a config that throws while loading', async () => {
    const root = project({
      'extension.config.mjs': "throw new Error('boom while loading')\n"
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(loadCustomConfig(root)).rejects.toThrow(/boom while loading/)

      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(String(errorSpy.mock.calls[0][0])).toContain('boom while loading')
    } finally {
      errorSpy.mockRestore()
    }
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
