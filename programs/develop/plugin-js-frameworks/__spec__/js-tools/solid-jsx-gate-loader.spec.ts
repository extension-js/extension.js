import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import solidJsxGateLoader, {
  mayContainJsx
} from '../../js-tools/solid-jsx-gate-loader'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-solid-gate-'))

afterAll(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

// A stand-in with babel-loader's own surface: custom() takes the override
// factory and returns the loader function.
function fakeBabelLoader(name: string) {
  const file = path.join(root, name)
  fs.writeFileSync(
    file,
    `
module.exports.custom = (factory) => {
  const overrides = factory({})

  return function (source, map) {
    overrides
      .customOptions(this.getOptions(), {source, map})
      .then((result) =>
        this.callback(null, 'babel:' + JSON.stringify(result.loader), map)
      )
  }
}
`
  )

  return file
}

function contextFor(options: Record<string, unknown>) {
  let done: (args: unknown[]) => void = () => {}

  const called = new Promise<unknown[]>((resolve) => {
    done = resolve
  })

  return {
    getOptions: vi.fn(() => options) as any,
    callback: vi.fn((...args: unknown[]) => done(args)) as any,
    called
  }
}

describe('mayContainJsx', () => {
  it.each([
    ['an element', 'export const a = () => <div>hi</div>\n'],
    ['a self-closing element', 'export const a = () => <App />\n'],
    ['a fragment', 'export const a = () => <>hi</>\n'],
    ['a spaced self-close', 'export const a = () => <input / >\n'],
    [
      'a self-close whose attribute compares',
      'export const a = (b, c) => <App on={b < c} />\n'
    ]
  ])('says yes to %s', (_name, source) => {
    expect(mayContainJsx(source)).toBe(true)
  })

  it.each([
    ['plain code', 'export const a = (b, c) => (b < c ? b : c)\n'],
    ['a url in a comment', '/* Lodash <https://lodash.com/> */\nexport {}\n'],
    ['markup in a string', 'export const a = "<div></div><br/>"\n'],
    ['a regex ending a tag', 'export const a = /<\\/script>/.test("x")\n'],
    [
      'a classic script with a top-level return',
      'if (window.done) return\nvar a = "</b>"\n'
    ]
  ])('says no to %s', (_name, source) => {
    expect(mayContainJsx(source)).toBe(false)
  })
})

describe('solid JSX gate loader', () => {
  const map = {version: 3, mappings: 'AAAA'}

  it('passes a file with no JSX on untouched, without loading Babel', () => {
    const source = '// <https://example.com/>\nexport const a = 1\n'
    const context = contextFor({
      babelLoader: path.join(root, 'never-loaded.js')
    })

    solidJsxGateLoader.call(context, source, map)

    expect(context.callback).toHaveBeenCalledWith(null, source, map)
    expect(context.getOptions).not.toHaveBeenCalled()
  })

  it('hands a file with JSX to babel-loader, with its own option taken out', async () => {
    const context = contextFor({
      babelLoader: fakeBabelLoader('babel-loader.cjs'),
      compact: false
    })

    solidJsxGateLoader.call(context, 'export const V = () => <p>hi</p>\n', map)

    expect(await context.called).toEqual([null, 'babel:{"compact":false}', map])
  })
})
