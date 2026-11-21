import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {SessionCommand} from '../types'
import {trackTempFolders} from './helpers/temp-folders'

// With no browser asked for, a command reads the config once to learn
// whether it names one. Nothing named means the stock default, so that first
// read sees the default browser's env files, as every later read does.
const tempFolder = trackTempFolders()
const PROBE = 'EXTENSION_PUBLIC_FROM_BROWSER_FILE'
const before = process.env[PROBE]

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, '__configProbeSeen')

  if (before === undefined) delete process.env[PROBE]
  else process.env[PROBE] = before
})

// Each evaluation records what it read, then names a browser nobody knows,
// so the command stops right after its first read of the config.
const CONFIG = `;(globalThis.__configProbeSeen ||= []).push(
  process.env.${PROBE} ?? null
)

const stop = {browser: 'no-such-browser'}

module.exports = {commands: {dev: stop, build: stop, preview: stop, start: stop}}
`

function project(envFile: string) {
  const root = tempFolder('extjs-config-probe-')
  const write = (file: string, text: string) =>
    fs.writeFileSync(path.join(root, file), text)

  write(
    'package.json',
    JSON.stringify({private: true, name: 'config-probe', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Config probe',
      version: '1.0.0'
    })
  )

  write('extension.config.js', CONFIG)
  write(envFile, `${PROBE}=from-the-browser-file\n`)
  fs.mkdirSync(path.join(root, 'dist', 'chromium'), {recursive: true})
  write(path.join('dist', 'chromium', 'manifest.json'), '{}')

  return root
}

function quiet() {
  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined)
  }
}

const seen = () =>
  (globalThis as {__configProbeSeen?: unknown[]}).__configProbeSeen || []

async function firstRead(command: SessionCommand, root: string, options = {}) {
  quiet()

  const run =
    command === 'dev'
      ? (await import('../command-dev')).extensionDev(root, {
          install: false,
          noBrowser: true,
          ...options
        })
      : command === 'build'
        ? (await import('../command-build')).extensionBuild(root, {
            install: false,
            exitOnError: false,
            ...options
          })
        : (await import('../command-preview')).extensionPreview(
            root,
            {metadataCommand: command, noBrowser: true, ...options},
            async () => undefined
          )

  const failure = await run.then(
    () => undefined,
    (error: Error) => error
  )

  return {failure, read: seen()[0]}
}

describe('the first config read of a command with no browser asked for', () => {
  it.each([
    ['dev', '.env.chromium'],
    ['dev', '.env.chrome'],
    ['build', '.env.chromium'],
    ['preview', '.env.chromium'],
    ['start', '.env.chromium']
  ] as const)('%s reads %s, the stock default browser file', async (command, file) => {
    const {failure, read} = await firstRead(command, project(file))

    expect(String(failure?.message)).toContain('no-such-browser')
    expect(read).toBe('from-the-browser-file')
  })

  it('reads the file of the family a binary picks, not the stock default', async () => {
    const root = project('.env.firefox')
    const {read} = await firstRead('dev', root, {
      geckoBinary: path.join(root, 'no-firefox-here')
    })

    expect(read).toBe('from-the-browser-file')
  })

  it('leaves another browser file unread', async () => {
    const {read} = await firstRead('dev', project('.env.firefox'))

    expect(read).toBeNull()
  })
})
