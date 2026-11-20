import * as fs from 'node:fs'
import * as path from 'node:path'
import {sources} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {restoreVerbatimCssAssets} from '../css-lib/verbatim-css'
import {pitch} from '../css-parse-guard-loader'

const makeTempFolder = trackTempFolders()

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g

const BROKEN_CSS = [
  '.ok { color: red; }',
  '.\\[default\\:\\\\u202F\\$\\{N\\(\\`\\$\\{u\\}\\`\\)\\}\\] {',
  '  default: \\u202F${N(`${u}`)};',
  '}',
  '.also-ok { display: none; }'
].join('\n')

function runPitch(
  resourcePath: string,
  module?: {type: string},
  rootContext?: string
) {
  return new Promise<{
    result: string | undefined
    warnings: Error[]
  }>((resolve, reject) => {
    const warnings: Error[] = []
    const ctx = {
      resourcePath,
      rootContext,
      _module: module,
      emitWarning: (w: Error) => warnings.push(w),
      async: () => (err: Error | null, content?: string) =>
        err ? reject(err) : resolve({result: content, warnings})
    }
    pitch.call(ctx as unknown as ThisParameterType<typeof pitch>)
  })
}

function writeTemp(name: string, content: string) {
  const dir = makeTempFolder('css-guard-')
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)

  return file
}

describe('css-parse-guard-loader', () => {
  it('lets valid CSS continue down the loader chain untouched', async () => {
    const file = writeTemp('valid.css', '.a { color: blue; }')
    const {result, warnings} = await runPitch(file)
    expect(result).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('ships unparseable CSS verbatim with a warning instead of failing (G17)', async () => {
    const file = writeTemp('output.css', BROKEN_CSS)
    const {result, warnings} = await runPitch(file)
    expect(result).toBe(BROKEN_CSS)
    expect(warnings.length).toBe(1)
    expect(String(warnings[0])).toMatch(/doesn't parse/i)
    expect(String(warnings[0])).toMatch(/copied as-is/i)
  })

  it('names the stylesheet by its path inside the project', async () => {
    const root = makeTempFolder('css-guard-root-')
    fs.mkdirSync(path.join(root, 'content'))
    const file = path.join(root, 'content', 'styles.css')
    fs.writeFileSync(file, 'a { color: red\n.b { }}} {{\n')

    const {warnings} = await runPitch(file, undefined, root)
    const lines = warnings[0].message.replace(ANSI, '').split('\n')
    expect(lines[1]).toBe('PATH content/styles.css')
    expect(warnings[0].message).not.toContain(root)
  })

  it('ignores non-.css resources (preprocessor errors stay fatal)', async () => {
    const file = writeTemp('styles.scss', 'this is not css at all {{{')
    const {result, warnings} = await runPitch(file)
    expect(result).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('hands the native css type a placeholder rule and keeps the raw sheet for the restore step', async () => {
    const file = writeTemp('native.css', BROKEN_CSS)
    const {result, warnings} = await runPitch(file, {type: 'css'})
    expect(warnings.length).toBe(1)
    expect(String(result)).toMatch(
      /^\.__extjs_verbatim_[a-z0-9]+__\{--extjs-verbatim:1\}/
    )

    // The restore step is the registry's one reader.
    const emitted = new Map([['native.css', String(result)]])
    const restored = restoreVerbatimCssAssets({
      getAssets: () =>
        [...emitted].map(([name, text]) => ({
          name,
          source: new sources.RawSource(text)
        })) as never,
      updateAsset: ((name: string, source: {source(): unknown}) =>
        emitted.set(name, String(source.source()))) as never
    })

    expect(restored).toEqual(['native.css'])
    expect(emitted.get('native.css')).toBe(BROKEN_CSS)
  })
})
