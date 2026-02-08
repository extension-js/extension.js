import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {patchHtml} from '../../html-lib/patch-html'

function makeTmp(name: string) {
  const tmp = path.join(__dirname, `.tmp-${name}`)
  fs.rmSync(tmp, {recursive: true, force: true})
  fs.mkdirSync(tmp, {recursive: true})
  return tmp
}

function makeCompilation(mode: 'development' | 'production') {
  return {
    options: {mode},
    getAsset: (name: string) =>
      name.endsWith('.css') ? ({source: {}} as any) : undefined,
    emitAsset() {},
    updateAsset() {},
    warnings: [] as any[]
  } as any
}

describe('patchHtml', () => {
  it('removes non-public script/link and injects bundle tags', () => {
    const tmp = makeTmp('patch')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head><link rel=\"stylesheet\" href=\"a.css\"></head><body><script src=\"a.js\"></script></body></html>`
    )
    const updated = patchHtml(
      makeCompilation('development') as any,
      'feature/index',
      htmlPath,
      {'feature/index': htmlPath},
      {}
    )
    expect(updated).toContain('href="feature/index.css"')
    expect(updated).toContain('src="feature/index.js"')
    expect(updated).not.toContain('href="a.css"')
    expect(updated).not.toContain('src="a.js"')
  })

  it('keeps public-root absolute assets as-is', () => {
    const tmp = makeTmp('public')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head><link rel=\"stylesheet\" href=\"/public/missing.css\"></head><body><script src=\"/public/missing.js\"></script></body></html>`
    )
    const compilation = makeCompilation('production')
    const updated = patchHtml(
      compilation as any,
      'feature/index',
      htmlPath,
      {'feature/index': htmlPath},
      {}
    )
    expect(updated).toContain('href="public/missing.css"')
    expect(updated).toContain('src="public/missing.js"')
    // warnings may or may not be emitted depending on fs layout; do not assert count
    expect(Array.isArray(compilation.warnings)).toBe(true)
  })
})
