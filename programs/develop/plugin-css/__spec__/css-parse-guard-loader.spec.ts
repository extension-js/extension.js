import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {pitch} from '../css-parse-guard-loader'

const BROKEN_CSS = [
  '.ok { color: red; }',
  '.\\[default\\:\\\\u202F\\$\\{N\\(\\`\\$\\{u\\}\\`\\)\\}\\] {',
  '  default: \\u202F${N(`${u}`)};',
  '}',
  '.also-ok { display: none; }'
].join('\n')

function runPitch(resourcePath: string) {
  return new Promise<{
    result: string | undefined
    warnings: Error[]
  }>((resolve, reject) => {
    const warnings: Error[] = []
    const ctx = {
      resourcePath,
      emitWarning: (w: Error) => warnings.push(w),
      async: () => (err: Error | null, content?: string) =>
        err ? reject(err) : resolve({result: content, warnings})
    }
    pitch.call(ctx as any)
  })
}

function writeTemp(name: string, content: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'css-guard-'))
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
    expect(String(warnings[0])).toMatch(/Invalid CSS/i)
    expect(String(warnings[0])).toMatch(/copied as-is/i)
  })

  it('ignores non-.css resources (preprocessor errors stay fatal)', async () => {
    const file = writeTemp('styles.scss', 'this is not css at all {{{')
    const {result, warnings} = await runPitch(file)
    expect(result).toBeUndefined()
    expect(warnings).toEqual([])
  })
})
