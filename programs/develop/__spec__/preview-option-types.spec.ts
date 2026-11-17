import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {extensionPreview, type ResolvedPreviewOptions} from '../command-preview'
import {trackTempFolders} from './helpers/temp-folders'

const require = createRequire(__filename)
const developRoot = path.resolve(__dirname, '..')
const tempFolder = trackTempFolders()

// What a library caller writes, checked by the compiler against the
// published option types. Only what it says about the probe file counts.
function typeErrors(source: string): string[] {
  const root = tempFolder('extjs-option-types-')

  fs.writeFileSync(
    path.join(root, 'probe.ts'),
    source.replace('./types', path.join(developRoot, 'types'))
  )

  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'esnext',
        target: 'esnext',
        moduleResolution: 'bundler',
        noEmit: true,
        skipLibCheck: true,
        types: []
      },
      files: ['probe.ts']
    })
  )

  const run = spawnSync(
    process.execPath,
    [
      path.join(
        path.dirname(require.resolve('typescript/package.json')),
        'bin',
        'tsc'
      ),
      '-p',
      root,
      '--pretty',
      'false'
    ],
    {cwd: root, encoding: 'utf8'}
  )

  return run.stdout
    .split('\n')
    .filter((line) => line.includes('error TS') && line.includes('probe.ts'))
}

describe('the launch options a library caller of preview and start can pass', () => {
  it('accepts browserFlags, excludeBrowserFlags and preferences on both', () => {
    expect(
      typeErrors(
        `import type {PreviewOptions, StartOptions} from './types'

export const preview: PreviewOptions = {
  browser: 'chrome',
  browserFlags: ['--from-call'],
  excludeBrowserFlags: ['--mute-audio'],
  preferences: {'some.pref': true}
}

export const start: StartOptions = {
  mode: 'production',
  browser: 'firefox',
  browserFlags: ['--from-call'],
  excludeBrowserFlags: ['--mute-audio'],
  preferences: {'some.pref': true}
}
`
      )
    ).toEqual([])
  }, 60_000)

  it('still refuses a key the commands do not know', () => {
    expect(
      typeErrors(
        `import type {PreviewOptions} from './types'

export const preview: PreviewOptions = {browser: 'chrome', browserFlag: []}
`
      )
    ).toHaveLength(1)
  }, 60_000)
})

describe('a launch option passed to preview beside a config file', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wins over the same key in extension.config.js', async () => {
    const root = fs.realpathSync(tempFolder('extjs-preview-options-'))
    const manifest = JSON.stringify({
      manifest_version: 3,
      name: 'preview-options',
      version: '1.0.0'
    })

    fs.mkdirSync(path.join(root, 'dist', 'chromium'), {recursive: true})
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({private: true, name: 'preview-options', version: '0.0.0'})
    )

    fs.writeFileSync(path.join(root, 'manifest.json'), manifest)
    fs.writeFileSync(
      path.join(root, 'dist', 'chromium', 'manifest.json'),
      manifest
    )

    fs.writeFileSync(
      path.join(root, 'extension.config.js'),
      'module.exports = {commands: {preview: {' +
        "browserFlags: ['--from-config'], " +
        "excludeBrowserFlags: ['--config-excluded'], " +
        "preferences: {'kept.pref': 1, 'shared.pref': 'config'}}}}\n"
    )

    const launcher = vi.fn(async (_opts: ResolvedPreviewOptions) => {})

    await extensionPreview(
      root,
      {
        browser: 'chromium',
        browserFlags: ['--from-call'],
        excludeBrowserFlags: ['--call-excluded'],
        preferences: {'shared.pref': 'call'}
      },
      launcher
    )

    const launched = launcher.mock.calls[0][0]

    expect(launched.preferences).toMatchObject({
      'kept.pref': 1,
      'shared.pref': 'call'
    })

    expect(launched.browserFlags).toEqual(
      expect.arrayContaining(['--from-config', '--from-call'])
    )

    expect(launched.excludeBrowserFlags).toContain('--call-excluded')
  })
})
