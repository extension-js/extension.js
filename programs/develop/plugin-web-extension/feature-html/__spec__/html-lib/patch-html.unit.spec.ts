import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {patchHtml, patchHtmlNested} from '../../html-lib/patch-html'

function makeTmp(name: string) {
  const tmp = path.join(__dirname, `.tmp-${name}`)
  fs.rmSync(tmp, {recursive: true, force: true})
  fs.mkdirSync(tmp, {recursive: true})
  return tmp
}

function makeCompilation(mode: 'development' | 'production'): Compilation {
  const compilation = {
    options: {mode} as Compilation['options'],
    getAsset: (name: string) =>
      name.endsWith('.css') ? ({source: {}} as any) : undefined,
    emitAsset() {},
    updateAsset() {},
    warnings: []
  }

  return compilation as unknown as Compilation
}

describe('patchHtml', () => {
  it('removes non-public script/link and injects bundle tags', () => {
    const tmp = makeTmp('patch')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head><link rel="stylesheet" href="a.css"></head><body><script src="a.js"></script></body></html>`
    )
    const updated = patchHtml(
      makeCompilation('development'),
      'feature/index',
      htmlPath,
      {'feature/index': htmlPath}
    )
    expect(updated).toContain('href="/feature/index.css"')
    expect(updated).toContain('src="/feature/index.js"')
    expect(updated).not.toContain('href="a.css"')
    expect(updated).not.toContain('src="a.js"')
  })

  it('patches the given markup instead of the file when html is passed', () => {
    const tmp = makeTmp('override')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head><title>$EXTENSION_PUBLIC_FOO</title></head><body><script src="a.js"></script></body></html>`
    )
    const updated = patchHtml(
      makeCompilation('production'),
      'feature/index',
      htmlPath,
      {'feature/index': htmlPath},
      tmp,
      ['/shared/commons.js'],
      `<html><head><title>envBar</title></head><body><script src="a.js"></script></body></html>`
    )
    expect(updated).toContain('<title>envBar</title>')
    expect(updated).not.toContain('$EXTENSION_PUBLIC_FOO')
    expect(updated).toContain('src="/shared/commons.js"')
    expect(updated).toContain('src="/feature/index.js"')
    expect(updated.indexOf('/shared/commons.js')).toBeLessThan(
      updated.indexOf('/feature/index.js')
    )
  })

  it('keeps public-root absolute assets as-is', () => {
    const tmp = makeTmp('public')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head><link rel="stylesheet" href="/public/missing.css"></head><body><script src="/public/missing.js"></script></body></html>`
    )
    const compilation = makeCompilation('production')
    const updated = patchHtml(compilation, 'feature/index', htmlPath, {
      'feature/index': htmlPath
    })
    expect(updated).toContain('href="/public/missing.css"')
    expect(updated).toContain('src="/public/missing.js"')
    expect(Array.isArray(compilation.warnings)).toBe(true)
  })
})

describe('patchHtmlNested root-absolute refs', () => {
  function makeNestedFixture(name: string, markup: string) {
    const tmp = makeTmp(name)
    const htmlPath = path.join(tmp, 'pages', 'nested.html')
    fs.mkdirSync(path.dirname(htmlPath), {recursive: true})
    fs.writeFileSync(htmlPath, markup)
    return {tmp, htmlPath}
  }

  function write(root: string, rel: string, content = '') {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  function missingWarnings(compilation: Compilation) {
    return (compilation.warnings as Array<{name?: string; message: string}>)
      .filter((warning) => warning.name === 'HtmlPublicAssetMissing')
      .map((warning) => warning.message)
  }

  const SCRIPT = `<html><body><script src="/lib/widget.js"></script></body></html>`

  it('does not warn when the root file exists', () => {
    const {tmp, htmlPath} = makeNestedFixture('nested-present', SCRIPT)
    write(tmp, 'lib/widget.js', 'console.log(1)')
    const compilation = makeCompilation('production')
    patchHtmlNested(compilation, htmlPath, tmp)
    expect(missingWarnings(compilation)).toEqual([])
  })

  it('warns when neither the file nor a source sibling exists', () => {
    const {tmp, htmlPath} = makeNestedFixture('nested-absent', SCRIPT)
    const compilation = makeCompilation('production')
    patchHtmlNested(compilation, htmlPath, tmp)
    const warnings = missingWarnings(compilation)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      "The page references a script file that doesn't exist."
    )
  })

  it('does not warn when a source sibling will be compiled to the .js path', () => {
    const {tmp, htmlPath} = makeNestedFixture('nested-sibling', SCRIPT)
    write(tmp, 'lib/widget.ts', 'export {}')
    const compilation = makeCompilation('production')
    patchHtmlNested(compilation, htmlPath, tmp)
    expect(missingWarnings(compilation)).toEqual([])
  })

  it('still warns for a non-JS ref even when a same-stem source exists', () => {
    const {tmp, htmlPath} = makeNestedFixture(
      'nested-non-js',
      `<html><head><link rel="stylesheet" href="/styles/page.css"></head><body></body></html>`
    )
    write(tmp, 'styles/page.ts', 'export {}')
    const compilation = makeCompilation('production')
    patchHtmlNested(compilation, htmlPath, tmp)
    const warnings = missingWarnings(compilation)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      "The page references a stylesheet that doesn't exist."
    )
  })

  it('keeps public/ precedence: a public file is fine and a public sibling still warns', () => {
    const present = makeNestedFixture('nested-public-present', SCRIPT)
    write(present.tmp, 'public/lib/widget.js', 'console.log(1)')
    const okCompilation = makeCompilation('production')
    patchHtmlNested(okCompilation, present.htmlPath, present.tmp)
    expect(missingWarnings(okCompilation)).toEqual([])

    const siblingOnly = makeNestedFixture('nested-public-sibling', SCRIPT)
    write(siblingOnly.tmp, 'public/lib/widget.ts', 'export {}')
    const warnCompilation = makeCompilation('production')
    patchHtmlNested(warnCompilation, siblingOnly.htmlPath, siblingOnly.tmp)
    expect(missingWarnings(warnCompilation)).toHaveLength(1)
  })
})
