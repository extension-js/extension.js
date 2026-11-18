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

  vi.spyOn(console, 'log').mockImplementation(() => {})

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

  return {summary, failure, stderr: stderr.join('\n')}
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
        text.startsWith('E_PROD_LOOPBACK_ORIGIN:')
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
