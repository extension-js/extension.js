import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {loadCommandConfig} from '../config-loader'

const makeTempFolder = trackTempFolders()

afterEach(() => {
  vi.restoreAllMocks()
})

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

async function warningsFor(config: string): Promise<string[]> {
  const dir = makeTempFolder('extjs-config-keys-')
  fs.writeFileSync(
    path.join(dir, 'extension.config.js'),
    `module.exports = ${config}\n`
  )

  const printed: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    printed.push(stripAnsi(args.join(' ')))
  })

  await loadCommandConfig(dir, 'dev', {mode: 'development'})

  return printed
}

describe('keys nothing reads under commands and browser', () => {
  it('names each one by its full path, with the key it likely meant', async () => {
    const printed = await warningsFor(`{
  commands: {
    dev: {startingUrll: 'https://example.com', port: 8080},
    biuld: {zip: true}
  },
  browser: {chrome: {brwoserFlags: ['--foo'], startingUrl: 'https://example.com'}}
}`)

    expect(printed.map((block) => block.split('\n')[0])).toEqual([
      expect.stringContaining('declares a key nothing reads: commands.biuld.'),
      expect.stringContaining(
        'declares a key nothing reads: commands.dev.startingUrll.'
      ),
      expect.stringContaining(
        'declares a key nothing reads: browser.chrome.brwoserFlags.'
      )
    ])

    expect(printed[0]).toContain('Did you mean commands.build?')
    expect(printed[1]).toContain('Did you mean commands.dev.startingUrl?')
    expect(printed[2]).toContain('Did you mean browser.chrome.browserFlags?')
  })

  it('names a build key under commands.dev, which dev never reads', async () => {
    const printed = await warningsFor(`{commands: {dev: {zip: true}}}`)

    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain(
      'declares a key nothing reads: commands.dev.zip.'
    )

    expect(printed[0]).toContain(
      'Remove it, or check its spelling against the FileConfig type.'
    )
  })

  it('names a key once when the config is read again under other env files', async () => {
    const dir = makeTempFolder('extjs-config-keys-twice-')
    fs.writeFileSync(
      path.join(dir, 'extension.config.js'),
      'module.exports = {commands: {dev: {startingUrll: process.env.EXTENSION_PUBLIC_KEYS_PICK}}}\n'
    )

    fs.writeFileSync(
      path.join(dir, '.env.development'),
      'EXTENSION_PUBLIC_KEYS_PICK=from-dev\n'
    )

    fs.writeFileSync(
      path.join(dir, '.env.production'),
      'EXTENSION_PUBLIC_KEYS_PICK=from-production\n'
    )

    const printed: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      printed.push(stripAnsi(args.join(' ')))
    })

    await loadCommandConfig(dir, 'dev', {mode: 'development'})
    await loadCommandConfig(dir, 'build', {mode: 'production'})

    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain('commands.dev.startingUrll')
  })

  it('stays quiet for keys each block reads, a fork browser block included', async () => {
    const printed = await warningsFor(`{
  commands: {
    dev: {port: 8080, startingUrl: 'https://example.com', define: {A: 1}},
    build: {zip: true, sourceMaps: true, outDir: 'out'},
    start: {startingUrl: 'https://example.com', perfBudgets: {page: 1}},
    preview: {outputPath: 'dist/chrome', noOpen: true}
  },
  browser: {
    firefox: {geckoBinary: '/bin/firefox', zip: true},
    'acme-webkit': {safariBinary: '/Applications/Acme.app'}
  }
}`)

    expect(printed).toEqual([])
  })
})
