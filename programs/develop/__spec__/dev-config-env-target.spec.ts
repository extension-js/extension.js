import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

const devServer = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../dev-server', () => ({devServer}))

vi.mock('../lib/ensure-develop-artifacts', () => ({
  ensureDevelopArtifacts: vi.fn(async () => {}),
  ensureUserProjectDependencies: vi.fn(async () => {})
}))

import {extensionDev} from '../command-dev'

// The config of a dev session reads the env files the bundle does: the
// development ones, and the ones named for the browser of the session.
const tempFolder = trackTempFolders()
const KEY = 'EXTENSION_PUBLIC_DEV_PICK'
let before: string | undefined

beforeEach(() => {
  before = process.env[KEY]
  delete process.env[KEY]
  devServer.mockClear()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()

  if (before === undefined) delete process.env[KEY]
  else process.env[KEY] = before
})

// Every run of the config appends the value it read, so the file says how
// many times the config ran and under which env files.
function project(configBody: string) {
  const root = fs.realpathSync(tempFolder('extjs-dev-env-'))

  writeExtensionProject(root, {name: 'dev-env'})

  fs.writeFileSync(
    path.join(root, 'extension.config.js'),
    `const fs = require('fs')
const path = require('path')
const picked = process.env.${KEY}
fs.appendFileSync(path.join(__dirname, 'runs.txt'), picked + '\\n')
module.exports = ${configBody}
`
  )

  fs.writeFileSync(path.join(root, '.env.development'), `${KEY}=from-dev\n`)
  fs.writeFileSync(path.join(root, '.env.firefox'), `${KEY}=from-firefox\n`)

  return root
}

function runs(root: string): string[] {
  return fs
    .readFileSync(path.join(root, 'runs.txt'), 'utf8')
    .split('\n')
    .filter(Boolean)
}

function startingUrl(): unknown {
  const options = (devServer.mock.calls[0] as unknown[] | undefined)?.[1]

  return (options as {startingUrl?: unknown} | undefined)?.startingUrl
}

describe('the env files a dev session config reads', () => {
  it('reads the file named for the asked browser, in one run', async () => {
    const root = project(
      `{commands: {dev: {startingUrl: 'https://' + picked + '.test/'}}}`
    )

    await extensionDev(root, {
      browser: 'firefox',
      noBrowser: true,
      install: false
    })

    expect(startingUrl()).toBe('https://from-firefox.test/')
    expect(runs(root)).toEqual(['from-firefox'])
  })

  it('reads the browser file in every layer, a block per browser included', async () => {
    const root = project(
      `{
  define: {PICKED: picked},
  browser: {firefox: {startingUrl: 'https://' + picked + '.test/'}}
}`
    )

    await extensionDev(root, {
      browser: 'firefox',
      noBrowser: true,
      install: false
    })

    const options = (devServer.mock.calls[0] as unknown[])[1] as {
      define?: unknown
    }

    expect(startingUrl()).toBe('https://from-firefox.test/')
    expect(options.define).toEqual({PICKED: 'from-firefox'})
    expect(runs(root)).toEqual(['from-firefox'])
  })

  it('reads the browser file after the config names the browser itself', async () => {
    const root = project(
      `{commands: {dev: {browser: 'firefox', startingUrl: 'https://' + picked + '.test/'}}}`
    )

    // No browser here on purpose: the config names it.
    await extensionDev(root, {noBrowser: true, install: false} as Parameters<
      typeof extensionDev
    >[1])

    expect(startingUrl()).toBe('https://from-firefox.test/')
    // The first run picks the browser, and only a changed name runs it again.
    expect(runs(root)).toEqual(['from-dev', 'from-firefox'])
  })
})
