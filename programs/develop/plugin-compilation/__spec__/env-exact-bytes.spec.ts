import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from '../../__spec__/helpers/build-project'
import {templateCopiedAsset} from '../copied-asset-env'
import {EnvPlugin} from '../env'
import {compile, makeTempRoot, removeTempRoots} from './helpers/real-compile'
import {writeProjectFiles} from '../../__spec__/helpers/extension-project'

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')
const hex = (...parts: string[]) => Buffer.from(parts.join(''), 'hex')
const ascii = (text: string) => Buffer.from(text, 'latin1')

// {"caf":"<e9 ff c3>"} in Latin-1, three bytes no UTF-8 text can hold.
const LATIN1_JSON = hex('7b22636166223a22', 'e9ffc3', '227d')
const UTF16_HTML = Buffer.concat([
  hex('fffe'),
  Buffer.from('<p>café</p>', 'utf16le')
])
const UTF8_BOM_HTML = Buffer.concat([
  hex('efbbbf'),
  Buffer.from('<p title="$EXTENSION_PUBLIC_FOO">café</p>', 'utf8')
])
const LATIN1_WITH_PLACEHOLDER = Buffer.concat([
  ascii('{"mode":"$EXTENSION_PUBLIC_FOO","caf":"'),
  hex('e9ffc3'),
  ascii('"}')
])
const UTF16_WITH_PLACEHOLDER = Buffer.concat([
  hex('fffe'),
  Buffer.from('<p>$EXTENSION_PUBLIC_FOO</p>', 'utf16le')
])

function writeBytes(root: string, files: Record<string, Buffer | string>) {
  writeProjectFiles(root, files)
}

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('EXTENSION_')) vi.stubEnv(key, undefined)
  }

  vi.stubEnv('EXTENSION_PUBLIC_FOO', 'envFoo')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(() => {
  removeTempRoots()
})

describe.each([
  'development',
  'production'
] as const)('emitted .json and .html bytes in %s', (mode) => {
  async function emit(files: Record<string, Buffer | string>) {
    const root = makeTempRoot('env-bytes')
    writeBytes(root, {'background.js': 'console.log(1)\n', ...files})

    const stats = await compile({
      context: root,
      outputPath: path.join(root, 'out'),
      mode,
      entry: {background: './background.js'},
      copy: Object.keys(files),
      plugins: [
        new EnvPlugin({
          manifestPath: path.join(root, 'manifest.json'),
          browser: 'chrome'
        })
      ]
    })

    return {
      bytes: (name: string) => {
        if (stats.compilation.errors.length) throw stats.compilation.errors[0]

        return fs.readFileSync(path.join(root, 'out', name))
      },
      warnings: Array.from(stats.compilation.warnings, (warning) => ({
        name: warning.name,
        message: stripAnsi(warning.message)
      })),
      errors: Array.from(stats.compilation.errors, (error) => error.message)
    }
  }

  it('ships a file with no placeholder byte for byte, whatever its encoding', async () => {
    const result = await emit({
      'latin1.json': LATIN1_JSON,
      'utf16.html': UTF16_HTML,
      'binary.json': hex('00ff80c0fe')
    })

    expect(result.bytes('latin1.json').toString('hex')).toBe(
      LATIN1_JSON.toString('hex')
    )

    expect(result.bytes('utf16.html').equals(UTF16_HTML)).toBe(true)
    expect(result.bytes('binary.json').toString('hex')).toBe('00ff80c0fe')
    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('fills a UTF-8 file and keeps its byte order mark', async () => {
    const result = await emit({'bom.html': UTF8_BOM_HTML})

    expect(result.bytes('bom.html').toString('hex')).toBe(
      Buffer.concat([
        hex('efbbbf'),
        Buffer.from('<p title="envFoo">café</p>', 'utf8')
      ]).toString('hex')
    )

    expect(result.warnings).toEqual([])
  })

  it('leaves a file that holds a placeholder but is not UTF-8 as it is, and names it once', async () => {
    const result = await emit({
      'latin1.json': LATIN1_WITH_PLACEHOLDER,
      'utf16.html': UTF16_WITH_PLACEHOLDER
    })

    expect(result.bytes('latin1.json').equals(LATIN1_WITH_PLACEHOLDER)).toBe(
      true
    )

    expect(result.bytes('utf16.html').equals(UTF16_WITH_PLACEHOLDER)).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings.map((warning) => warning.name)).toEqual([
      'EnvPlaceholderNotUtf8'
    ])

    expect(result.warnings[0].message).toContain(
      'latin1.json, utf16.html hold a $EXTENSION_* placeholder but are not UTF-8 text'
    )

    expect(result.warnings[0].message).toContain('Save the file as UTF-8')
    expect(result.warnings[0].message).not.toContain('envFoo')
  })
})

describe('a late copy of a .json or .html file', () => {
  it('goes through the same byte rules as an emitted asset', async () => {
    const root = makeTempRoot('env-bytes-late')
    writeBytes(root, {'background.js': 'console.log(1)\n'})
    const seen: Record<string, Buffer> = {}

    const stats = await compile({
      context: root,
      outputPath: path.join(root, 'out'),
      entry: {background: './background.js'},
      plugins: [
        new EnvPlugin({
          manifestPath: path.join(root, 'manifest.json'),
          browser: 'chrome'
        }),
        {
          apply(compiler) {
            compiler.hooks.thisCompilation.tap('late-copy', (compilation) => {
              compilation.hooks.processAssets.tap(
                {
                  name: 'late-copy',
                  stage: compiler.rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT
                },
                () => {
                  for (const [name, bytes] of Object.entries({
                    'plain.json': LATIN1_JSON,
                    'held.json': LATIN1_WITH_PLACEHOLDER,
                    'filled.html': UTF8_BOM_HTML
                  })) {
                    seen[name] = templateCopiedAsset(compilation, name, bytes)
                  }
                }
              )
            })
          }
        }
      ]
    })

    expect(seen['plain.json']).toBe(LATIN1_JSON)
    expect(seen['held.json']).toBe(LATIN1_WITH_PLACEHOLDER)
    expect(seen['filled.html'].toString('utf8')).toBe(
      '﻿<p title="envFoo">café</p>'
    )

    expect(
      Array.from(stats.compilation.warnings, (warning) =>
        stripAnsi(warning.message)
      )
    ).toEqual([expect.stringContaining('held.json holds a $EXTENSION_*')])
  })
})

describe.each([
  'development',
  'production'
] as const)('a real %s build', (mode) => {
  it('ships public, page-linked and web accessible copies byte for byte', async () => {
    const root = makeTempRoot('env-bytes-build')
    writeBytes(root, {
      'package.json': JSON.stringify({private: true, name: 'bytes'}),
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'bytes',
        version: '1.0.0',
        web_accessible_resources: [
          {resources: ['war/latin1.json'], matches: ['<all_urls>']}
        ]
      }),
      'public/pub-latin1.json': LATIN1_JSON,
      'public/pub-utf16.html': UTF16_HTML,
      'public/pub-held.json': LATIN1_WITH_PLACEHOLDER,
      'public/pub-filled.json': '{"foo":"$EXTENSION_PUBLIC_FOO"}',
      'war/latin1.json': LATIN1_JSON
    })

    const summary = await buildProject(root, {mode})
    const dist = (name: string) =>
      fs.readFileSync(path.join(root, 'dist', 'chrome', name))

    expect(summary.errors_count).toBe(0)
    expect(
      (summary.warnings || []).filter((line) =>
        line.startsWith('W_ENV_ASSET_NOT_UTF8: ')
      )
    ).toEqual([expect.stringContaining('pub-held.json holds a $EXTENSION_*')])

    expect(dist('pub-latin1.json').toString('hex')).toBe(
      LATIN1_JSON.toString('hex')
    )

    expect(dist('pub-utf16.html').equals(UTF16_HTML)).toBe(true)
    expect(dist('pub-held.json').equals(LATIN1_WITH_PLACEHOLDER)).toBe(true)
    expect(dist('pub-filled.json').toString('utf8')).toBe('{"foo":"envFoo"}')
    expect(dist('war/latin1.json').toString('hex')).toBe(
      LATIN1_JSON.toString('hex')
    )
  })
})
