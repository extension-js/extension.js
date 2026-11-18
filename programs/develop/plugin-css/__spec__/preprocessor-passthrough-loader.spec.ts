import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import preprocessorPassthroughLoader from '../preprocessor-passthrough-loader'

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g

function run(resourcePath: string, source: string, rootContext?: string) {
  const warnings: Error[] = []
  const result = preprocessorPassthroughLoader.call(
    {
      resourcePath,
      rootContext,
      emitWarning: (w: Error) => warnings.push(w)
    } as any,
    source
  )

  return {result, warnings}
}

describe('preprocessor-passthrough-loader', () => {
  it('ships SCSS verbatim with an install-sass warning', () => {
    const source = '$badge-bg: red;\n.badge { background: $badge-bg; }'
    const {result, warnings} = run('/project/popup/styles.scss', source)
    expect(result).toBe(source)
    expect(warnings.length).toBe(1)
    expect(String(warnings[0])).toMatch(/shipped uncompiled/)
    expect(String(warnings[0])).toMatch(/The sass package isn't installed/)
    expect(String(warnings[0])).toMatch(/npm install --save-dev sass/)
  })

  it('names the file by its path inside the project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-passthrough-'))

    try {
      fs.mkdirSync(path.join(root, 'popup'))
      const file = path.join(root, 'popup', 'styles.scss')
      fs.writeFileSync(file, '$a: red;\n')

      const {warnings} = run(file, '$a: red;\n', root)
      const lines = warnings[0].message.replace(ANSI, '').split('\n')
      expect(lines[1]).toBe('PATH popup/styles.scss')
      expect(warnings[0].message).not.toContain(root)
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('ships .sass verbatim with an install-sass warning', () => {
    const {result, warnings} = run('/project/styles.sass', '.a\n  color: red')
    expect(result).toBe('.a\n  color: red')
    expect(warnings.length).toBe(1)
    expect(String(warnings[0])).toMatch(/The sass package isn't installed/)
  })

  it('ships LESS verbatim with an install-less warning', () => {
    const source = '@badge-bg: red;\n.badge { background: @badge-bg; }'
    const {result, warnings} = run('/project/content/styles.less', source)
    expect(result).toBe(source)
    expect(warnings.length).toBe(1)
    expect(String(warnings[0])).toMatch(/shipped uncompiled/)
    expect(String(warnings[0])).toMatch(/The less package isn't installed/)
    expect(String(warnings[0])).toMatch(/npm install --save-dev less/)
  })
})
