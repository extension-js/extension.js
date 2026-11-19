import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'

// What a build says when it fails or warns, read the way a caller reads it:
// the code on the rejection, the lines on stderr, the summary it returns.
const tempFolder = trackTempFolders()

afterEach(() => {
  vi.restoreAllMocks()
})

// The text without its colors and without the channel glyph at its head.
const plain = (text: unknown) =>
  String(text)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^\S+ /, '')

function project(matches: string[], config?: string) {
  const root = fs.realpathSync(tempFolder('extjs-failure-codes-'))
  const write = (file: string, text: string) =>
    fs.writeFileSync(path.join(root, file), text)

  write(
    'package.json',
    JSON.stringify({private: true, name: 'codes', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'codes',
      version: '1.0.0',
      content_scripts: [{matches, js: ['content.js']}]
    })
  )

  write('content.js', 'console.log(1)\n')

  if (config) write('extension.config.js', config)

  return root
}

async function build(root: string, options: Record<string, unknown>) {
  const {extensionBuild} = await import('../command-build')
  const stderr: string[] = []
  const stdout: string[] = []

  vi.spyOn(console, 'log').mockImplementation((...parts) => {
    stdout.push(parts.map(String).join(' '))
  })

  for (const method of ['warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...parts) => {
      stderr.push(parts.map(String).join(' '))
    })
  }

  let summary: Awaited<ReturnType<typeof extensionBuild>> | undefined
  let failure: (Error & {code?: string; cause?: unknown}) | undefined

  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      install: false,
      mode: 'production',
      ...options
    } as never)
  } catch (error) {
    failure = error as Error & {code?: string}
  } finally {
    vi.restoreAllMocks()
  }

  return {
    summary,
    failure,
    stderr: stderr.join('\n'),
    stdout: stdout.join('\n')
  }
}

describe('build: a config hook that throws (real rspack)', () => {
  it('rejects under the config code and names the file and the reason once', async () => {
    const root = project(
      ['https://example.com/*'],
      "module.exports = {config: () => {\n  throw new Error('hook exploded')\n}}\n"
    )

    const built = await build(root, {silent: true})

    expect(built.failure?.code).toBe('E_CONFIG_LOAD')
    expect((built.failure?.cause as Error).message).toBe('hook exploded')
    expect(plain(built.failure?.message)).toBe(
      "Couldn't load extension.config.js.\n" +
        `PATH ${path.join(root, 'extension.config.js')}\n` +
        'hook exploded\n' +
        'Fix the config file, then run the command again.'
    )

    expect(built.stderr.split('hook exploded').length).toBe(2)
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false)
  }, 120_000)

  it('names where a hook threw an error that has no message', async () => {
    const root = project(
      ['https://example.com/*'],
      "module.exports = {config: () => {\n  throw new Error('')\n}}\n"
    )

    const built = await build(root, {silent: true})

    expect(built.failure?.code).toBe('E_CONFIG_LOAD')
    expect(plain(built.failure?.message).split('\n')[2]).toMatch(
      /^An error with no message was thrown at extension\.config\.js:2:\d+\.$/
    )
  }, 120_000)
})

describe('build: a config hook that returns no config (real rspack)', () => {
  it.each([
    ['nothing', '(config) => {\n  config.devtool = false\n}', 'undefined'],
    ['a promise', 'async (config) => config', 'a promise'],
    ['a string', "() => 'production'", 'a string']
  ])(
    'refuses a hook that returns %s under the config code',
    async (_label, hook, found) => {
      const root = project(
        ['https://example.com/*'],
        `module.exports = {config: ${hook}}\n`
      )

      const built = await build(root, {silent: true})
      const said =
        `The config hook in extension.config.js must return the config, found ${found}.\n` +
        `PATH ${path.join(root, 'extension.config.js')}\n` +
        'End the hook with return config, then run the command again.'

      expect(built.failure?.code).toBe('E_CONFIG_LOAD')
      expect(plain(built.failure?.message)).toBe(said)
      // The block is printed once, whole, and the count closes the run.
      const [block, closing, ...rest] = built.stderr.split(
        /\n(?=\S+ Build failed)/
      )

      expect(plain(block)).toBe(said)
      expect(plain(closing)).toBe('Build failed with 1 error.')
      expect(rest).toEqual([])
      expect(fs.existsSync(path.join(root, 'dist'))).toBe(false)
    },
    120_000
  )
})

// The bundler runs each plugin while it is built, before any compile, so a
// throw there is the plugin's and not a compile error in the project.
describe('build: a plugin that throws while it is applied (real rspack)', () => {
  const plugin = (body: string) =>
    'module.exports = {config: (config) => {\n' +
    `  config.plugins.push({apply(compiler) {\n    ${body}\n  }})\n` +
    '  return config\n}}\n'

  it('rejects under the fatal code and keeps what the plugin said', async () => {
    const root = project(
      ['https://example.com/*'],
      plugin("throw new Error('apply exploded')")
    )

    const built = await build(root, {silent: true})

    expect(built.failure?.code).toBe('E_COMPILE_FATAL')
    expect(built.failure?.message).toBe('apply exploded')
    expect((built.failure?.cause as Error).message).toBe('apply exploded')
    expect(built.stderr.split('\n').map(plain)).toEqual([
      'apply exploded',
      'Build failed with 1 error.'
    ])
  }, 120_000)

  it('keeps the code a plugin declared on what it threw', async () => {
    const root = project(
      ['https://example.com/*'],
      plugin(
        "throw Object.assign(new Error('bad option'), {code: 'E_INVALID_OPTION'})"
      )
    )

    const built = await build(root, {silent: true})

    expect(built.failure?.code).toBe('E_INVALID_OPTION')
    expect(built.failure?.message).toBe('bad option')
  }, 120_000)

  it('names where an error with no message was thrown from', async () => {
    const root = project(
      ['https://example.com/*'],
      plugin("throw new Error('')")
    )

    const built = await build(root, {silent: true})

    expect(built.failure?.code).toBe('E_COMPILE_FATAL')
    expect(built.failure?.message).toMatch(
      /^An error with no message was thrown at extension\.config\.js:3:\d+\.$/
    )

    expect(built.stderr.split('\n').map(plain)).toEqual([
      built.failure?.message,
      'Build failed with 1 error.'
    ])
  }, 120_000)

  it('names the place for a hook that throws with no message too', async () => {
    const root = project(
      ['https://example.com/*'],
      plugin(
        "compiler.hooks.done.tap('late', () => {\n      throw new Error('')\n    })"
      )
    )

    const built = await build(root, {silent: true})

    expect(built.failure?.code).toBe('E_COMPILE_FATAL')
    expect(built.failure?.message).toMatch(
      /^An error with no message was thrown at extension\.config\.js:4:\d+\.$/
    )
  }, 120_000)
})

// The compile line is the receipt of a compile that went through, and a
// plugin can still fail the build after the bundler has finished.
describe('build: a plugin that throws once the compile is done (real rspack)', () => {
  const config = (body: string) =>
    'module.exports = {config: (config) => {\n' +
    "  config.plugins.push({apply(compiler) {\n    compiler.hooks.done.tap('late', () => {\n" +
    `      ${body}\n    })\n  }})\n` +
    '  return config\n}}\n'

  it('prints the compile line for a build that goes through', async () => {
    const root = project(['https://example.com/*'], config('return'))

    const built = await build(root, {silent: false})

    expect(built.failure).toBeUndefined()
    expect(plain(built.stdout)).toMatch(/codes compiled in \d+ ms\./)
  }, 120_000)

  it('prints no compile line for a build that fails', async () => {
    const root = project(
      ['https://example.com/*'],
      config("throw new Error('done exploded')")
    )

    const built = await build(root, {silent: false})

    expect(built.failure?.code).toBe('E_COMPILE_FATAL')
    expect(built.failure?.message).toBe('done exploded')
    expect(built.stdout).not.toContain('compiled')
    expect(built.stderr.split('\n').map(plain)).toEqual([
      'done exploded',
      'Build failed with 1 error.'
    ])
  }, 120_000)
})

// A plugin can throw anything, and the failure line is built from what it
// threw, so a value with no message to read used to end the build unsaid.
describe('build: a thrown value with no readable message (real rspack)', () => {
  const plugin = (thrown: string) =>
    'module.exports = {config: (config) => {\n' +
    `  config.plugins.push({apply() {\n    ${thrown}\n  }})\n` +
    '  return config\n}}\n'

  it.each([
    [
      'an object that cannot become a string',
      'throw Object.create(null)',
      'A value that is not an Error was thrown: {}.'
    ],
    [
      'an Error whose message throws when read',
      "const error = new Error('x')\n" +
        "    Object.defineProperty(error, 'message', {get() { throw new Error('unreadable') }})\n" +
        '    throw error',
      'A value that cannot be read was thrown.'
    ]
  ])(
    'prints %s once and rejects with an Error that wraps it',
    async (_label, thrown, said) => {
      const root = project(['https://example.com/*'], plugin(thrown))

      const built = await build(root, {silent: true})

      expect(built.stderr.split('\n').map(plain)).toEqual([
        said,
        'Build failed with 1 error.'
      ])

      expect(built.failure).toBeInstanceOf(Error)
      expect(built.failure?.message).toBe(said)
      // Compared by hand: a matcher would read the message that throws.
      expect(typeof built.failure?.cause).toBe('object')
      expect(built.failure?.cause === built.failure).toBe(false)
    },
    120_000
  )
})

describe('build: a silent build keeps its warnings off stderr (real rspack)', () => {
  const loopback = ['https://example.com/*', 'http://localhost:4322/*']

  it('prints no warning and still returns it with its code', async () => {
    const built = await build(project(loopback), {silent: true})

    expect(built.failure).toBeUndefined()
    expect(built.stderr).toBe('')
    expect(
      (built.summary?.warnings || []).filter((text) =>
        text.startsWith('W_PROD_LOOPBACK_ORIGIN:')
      )
    ).toHaveLength(1)
  }, 120_000)

  it('prints the same warning when silent is off', async () => {
    const built = await build(project(loopback), {silent: false})

    expect(built.failure).toBeUndefined()
    expect(plain(built.stderr)).toContain(
      'The production manifest reaches the local machine:'
    )
  }, 120_000)
})

// A caller reading a failure wants what the run carried on past as well,
// in the lines a green build lists in its summary.
describe('build: a failed build keeps its coded warnings (real rspack)', () => {
  const managed = (root: string, config: string) => {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        private: true,
        name: 'codes',
        version: '0.0.0',
        dependencies: {'@rspack/core': '^2.0.0'}
      })
    )

    fs.writeFileSync(
      path.join(root, 'extension.config.js'),
      `const lazy = () => require('@rspack/core')\n${config}\n`
    )
  }

  const warned = (failure: unknown) =>
    (failure as {warnings?: string[]} | undefined)?.warnings || []

  it('lists them on a compile failure', async () => {
    const root = project(['https://example.com/*'])

    managed(root, 'module.exports = {}')
    fs.writeFileSync(path.join(root, 'content.js'), "import './gone.js'\n")

    const built = await build(root, {silent: true})

    expect(built.failure?.code).toBe('E_COMPILE')
    expect(warned(built.failure)).toHaveLength(1)
    expect(warned(built.failure)[0]).toMatch(
      /^W_MANAGED_DEP_CONFLICT: extension\.config\.js loads its own copy of @rspack\/core /
    )
  }, 120_000)

  it('lists them on a failure that is not a compile error', async () => {
    const root = project(['https://example.com/*'])

    managed(
      root,
      'module.exports = {config: (config) => {\n' +
        "  config.plugins.push({apply() { throw new Error('apply exploded') }})\n" +
        '  return config\n}}'
    )

    const built = await build(root, {silent: true})

    expect(built.failure?.code).toBe('E_COMPILE_FATAL')
    expect(warned(built.failure)).toHaveLength(1)
    expect(warned(built.failure)[0]).toMatch(/^W_MANAGED_DEP_CONFLICT: /)
  }, 120_000)

  it('adds no list to a failure that carried on past nothing', async () => {
    const root = project(['https://example.com/*'])

    fs.writeFileSync(path.join(root, 'content.js'), "import './gone.js'\n")

    const built = await build(root, {silent: true})

    expect(built.failure?.code).toBe('E_COMPILE')
    expect(built.failure).not.toHaveProperty('warnings')
  }, 120_000)
})
