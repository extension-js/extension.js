import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  COMPILED_SIBLING_EXTENSIONS,
  findCompiledRootRefSource
} from '../../html-lib/compiled-root-ref'

const tmp = path.join(__dirname, '.tmp-compiled-root-ref')
const publicDir = path.join(tmp, 'public')

function write(rel: string, content = '') {
  const abs = path.join(tmp, rel)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, content)

  return abs
}

function reset() {
  fs.rmSync(tmp, {recursive: true, force: true})
  fs.mkdirSync(tmp, {recursive: true})
}

afterAll(() => {
  fs.rmSync(tmp, {recursive: true, force: true})
})

describe('findCompiledRootRefSource', () => {
  it('finds the source the build compiles to a missing root .js ref', () => {
    reset()
    const source = write('lib/widget.ts', 'export {}')
    expect(findCompiledRootRefSource('/lib/widget.js', tmp, publicDir)).toBe(
      source
    )
  })

  it('accepts every spelling the tracer compiles to .js', () => {
    for (const ext of COMPILED_SIBLING_EXTENSIONS) {
      reset()
      const source = write(`lib/widget${ext}`)
      expect(
        findCompiledRootRefSource('/lib/widget.js', tmp, publicDir),
        ext
      ).toBe(source)
    }
  })

  it('returns undefined when nothing on disk produces the file', () => {
    reset()
    write('lib/other.ts')
    expect(
      findCompiledRootRefSource('/lib/widget.js', tmp, publicDir)
    ).toBeUndefined()
  })

  it('ignores a sibling for a ref that is not a .js file', () => {
    reset()
    write('data/x.ts')
    write('styles/page.ts')
    expect(
      findCompiledRootRefSource('/data/x.json', tmp, publicDir)
    ).toBeUndefined()

    expect(
      findCompiledRootRefSource('/styles/page.css', tmp, publicDir)
    ).toBeUndefined()

    // .mjs and .cjs refs are served as written, the tracer never maps them.
    write('lib/widget.ts')
    expect(
      findCompiledRootRefSource('/lib/widget.mjs', tmp, publicDir)
    ).toBeUndefined()
  })

  it('lets public/ win: a public file is copied verbatim and a public sibling does not count', () => {
    reset()
    write('lib/widget.ts')
    write('public/lib/widget.js')
    expect(
      findCompiledRootRefSource('/lib/widget.js', tmp, publicDir)
    ).toBeUndefined()

    reset()
    write('public/lib/widget.ts')
    expect(
      findCompiledRootRefSource('/lib/widget.js', tmp, publicDir)
    ).toBeUndefined()
  })

  it('ignores non-root refs, protocol-relative URLs, filesystem paths and escapes', () => {
    reset()
    write('lib/widget.ts')
    write('widget.ts')
    expect(
      findCompiledRootRefSource('lib/widget.js', tmp, publicDir)
    ).toBeUndefined()

    expect(
      findCompiledRootRefSource('./lib/widget.js', tmp, publicDir)
    ).toBeUndefined()

    expect(
      findCompiledRootRefSource('//cdn.example.com/widget.js', tmp, publicDir)
    ).toBeUndefined()

    expect(
      findCompiledRootRefSource(path.join(tmp, 'lib/widget.js'), tmp, publicDir)
    ).toBeUndefined()

    expect(
      findCompiledRootRefSource('/../widget.js', tmp, publicDir)
    ).toBeUndefined()
  })
})
