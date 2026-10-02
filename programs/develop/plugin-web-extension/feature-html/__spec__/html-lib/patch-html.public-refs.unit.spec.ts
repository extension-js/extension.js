import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {rememberPublicRoots} from '../../../../plugin-special-folders/resolve-public-folder'
import {patchHtml} from '../../html-lib/patch-html'

const roots: string[] = []

function makeProject(name: string) {
  const root = path.join(__dirname, `.tmp-public-${name}`)
  fs.rmSync(root, {recursive: true, force: true})
  fs.mkdirSync(path.join(root, 'public', 'sub'), {recursive: true})
  fs.writeFileSync(path.join(root, 'public', 'p.png'), 'png')
  fs.writeFileSync(path.join(root, 'public', 'sub', 'q.png'), 'png')
  fs.writeFileSync(path.join(root, 'logo.png'), 'png')
  roots.push(root)

  return root
}

function makeCompilation(publicDir: string): Compilation {
  const compiler = {}
  rememberPublicRoots(compiler, [publicDir])

  return {
    compiler,
    options: {mode: 'production'} as Compilation['options'],
    getAsset: () => undefined,
    emitAsset() {},
    updateAsset() {},
    warnings: []
  } as unknown as Compilation
}

function rewrite(root: string, html: string): string {
  // The page sits at the project root, so a relative public/ reference
  // resolves the way it does in a real project.
  const htmlPath = path.join(root, 'index.html')
  fs.writeFileSync(htmlPath, html)

  return patchHtml(
    makeCompilation(path.join(root, 'public')),
    'action',
    htmlPath,
    {},
    root
  )
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('patchHtml public folder references', () => {
  // The copier flattens public/ onto the output root and the emitter skips
  // those files, so every documented spelling has to name the flattened path.
  it.each([
    ['./public/p.png', '/p.png'],
    ['public/p.png', '/p.png'],
    ['/p.png', '/p.png'],
    ['./public/sub/q.png', '/sub/q.png']
  ])('rewrites %s to %s', (reference, expected) => {
    const root = makeProject('spellings')
    const updated = rewrite(
      root,
      `<html><body><img src="${reference}"></body></html>`
    )

    expect(updated).toContain(`src="${expected}"`)
    expect(updated).not.toContain('assets/public')
  })

  it('still routes an asset outside public under assets/', () => {
    const root = makeProject('outside')
    const updated = rewrite(
      root,
      `<html><body><img src="./logo.png"></body></html>`
    )

    expect(updated).toContain('assets/logo.png')
  })

  it('leaves the assets path alone when the project has no public folder', () => {
    const root = makeProject('nopublic')
    fs.rmSync(path.join(root, 'public'), {recursive: true, force: true})
    const htmlPath = path.join(root, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><body><img src="./logo.png"></body></html>`
    )

    const compiler = {}
    rememberPublicRoots(compiler, [])
    const compilation = {
      compiler,
      options: {mode: 'production'} as Compilation['options'],
      getAsset: () => undefined,
      emitAsset() {},
      updateAsset() {},
      warnings: []
    } as unknown as Compilation

    const updated = patchHtml(compilation, 'action', htmlPath, {}, root)
    expect(updated).toContain('assets/logo.png')
  })
})
