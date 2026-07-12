import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {
  collectRootAbsoluteRefs,
  resolveRootAbsoluteRef
} from '../../shared/paths'

let root: string

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'root-abs-'))
  fs.mkdirSync(path.join(root, 'nscl'), {recursive: true})
  fs.mkdirSync(path.join(root, 'public', 'img'), {recursive: true})
  fs.writeFileSync(path.join(root, 'nscl', 'main.js'), '// nscl')
  fs.writeFileSync(path.join(root, 'public', 'img', 'in-public.svg'), '<svg/>')
  fs.writeFileSync(path.join(root, 'also-at-root.svg'), '<svg/>')
  // same ref name present in BOTH public/ and the root: public/ must win
  fs.mkdirSync(path.join(root, 'img'), {recursive: true})
  fs.writeFileSync(path.join(root, 'img', 'in-public.svg'), '<svg>root</svg>')
})

afterAll(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

describe('resolveRootAbsoluteRef', () => {
  const publicDir = () => path.join(root, 'public')

  it('resolves a root-absolute ref from the extension root (Chrome semantics)', () => {
    // The §18 case: hackademix/noscript ships ui/options.html -> "/nscl/main.js"
    expect(resolveRootAbsoluteRef('/nscl/main.js', root, publicDir())).toBe(
      path.join(root, 'nscl', 'main.js')
    )
  })

  it('lets public/ win when it satisfies the ref', () => {
    expect(
      resolveRootAbsoluteRef('/img/in-public.svg', root, publicDir())
    ).toBeUndefined()
  })

  it('resolves from the root when there is no public/ dir at all', () => {
    expect(resolveRootAbsoluteRef('/also-at-root.svg', root, undefined)).toBe(
      path.join(root, 'also-at-root.svg')
    )
  })

  it('leaves a genuinely missing ref unclaimed so it is still reported', () => {
    expect(
      resolveRootAbsoluteRef('/nope/missing.js', root, publicDir())
    ).toBeUndefined()
  })

  it('ignores relative refs, protocol-relative URLs and real filesystem paths', () => {
    expect(resolveRootAbsoluteRef('./x.js', root, publicDir())).toBeUndefined()
    expect(
      resolveRootAbsoluteRef('//cdn.example.com/x.js', root, publicDir())
    ).toBeUndefined()
    expect(
      resolveRootAbsoluteRef(path.join(root, 'nscl', 'main.js'), root, publicDir())
    ).toBeUndefined()
  })

  it('refuses to escape the extension root', () => {
    expect(
      resolveRootAbsoluteRef('/../../etc/passwd', root, publicDir())
    ).toBeUndefined()
  })

  it('does not claim a directory', () => {
    expect(resolveRootAbsoluteRef('/nscl', root, publicDir())).toBeUndefined()
  })
})

describe('collectRootAbsoluteRefs', () => {
  it('finds root refs in HTML src/href and CSS url()', () => {
    const refs = collectRootAbsoluteRefs(
      `<link rel="stylesheet" href="/css/opt.css">
       <script src="/nscl/main.js"></script>
       <script src="./relative.js"></script>
       <a href="https://example.com/page">x</a>
       body { background: url("/img/warning.svg") }`
    )
    expect([...refs].sort()).toEqual([
      '/css/opt.css',
      '/img/warning.svg',
      '/nscl/main.js'
    ])
  })
})
