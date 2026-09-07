import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {patchHtml, patchHtmlNested} from '../html-lib/patch-html'
import {siblingScriptsFor} from '../steps/update-html-file'

// A page whose entry was split into several initial files must load every
// sibling chunk before its own bundle, with the author's tag attributes.
const tmpRoots: string[] = []

afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, {recursive: true, force: true})
})

function makeTmp(name: string) {
  const tmp = path.join(__dirname, `.tmp-split-${name}`)
  fs.rmSync(tmp, {recursive: true, force: true})
  fs.mkdirSync(tmp, {recursive: true})
  tmpRoots.push(tmp)
  return tmp
}

function makeCompilation(mode: 'development' | 'production'): Compilation {
  return {
    options: {mode},
    getAsset: () => undefined,
    emitAsset() {},
    updateAsset() {},
    warnings: []
  } as unknown as Compilation
}

function scriptTags(html: string): string[] {
  return html.match(/<script[^>]*>/gi) || []
}

function srcOf(tag: string): string | undefined {
  return tag.match(/\ssrc="([^"]+)"/)?.[1]
}

const SIBLINGS = ['/shared/framework.js', '/shared/commons.js']

describe('patchHtml with sibling chunks', () => {
  it('puts every sibling before the entry tag, in the given order, in place', () => {
    const tmp = makeTmp('in-place')
    fs.writeFileSync(path.join(tmp, 'popup.js'), 'console.log(1)')
    const htmlPath = path.join(tmp, 'popup.html')
    fs.writeFileSync(
      htmlPath,
      [
        '<html><body>',
        '<div id="root"></div>',
        '<script type="module" defer src="./popup.js"></script>',
        '<script>window.__after = true</script>',
        '</body></html>'
      ].join('')
    )

    const updated = patchHtml(
      makeCompilation('production'),
      'action/index',
      htmlPath,
      {'action/index': htmlPath},
      tmp,
      SIBLINGS
    )

    const tags = scriptTags(updated)
    expect(tags.map(srcOf)).toEqual([
      '/shared/framework.js',
      '/shared/commons.js',
      '/action/index.js',
      undefined
    ])
    for (const tag of tags.slice(0, 3)) {
      expect(tag).toContain('type="module"')
      expect(tag).toMatch(/\sdefer(=""|\s|>)/)
    }
    expect(updated.indexOf('/action/index.js')).toBeLessThan(
      updated.indexOf('window.__after')
    )
    expect(updated).not.toContain('./popup.js')
  })

  it('appends the siblings then the entry when the page has no bundled tag', () => {
    const tmp = makeTmp('append')
    const htmlPath = path.join(tmp, 'options.html')
    fs.writeFileSync(
      htmlPath,
      '<html><body><div id="root"></div></body></html>'
    )

    const updated = patchHtml(
      makeCompilation('development'),
      'options/index',
      htmlPath,
      {'options/index': htmlPath},
      tmp,
      SIBLINGS
    )

    expect(scriptTags(updated).map(srcOf)).toEqual([
      '/shared/framework.js',
      '/shared/commons.js',
      '/options/index.js'
    ])
  })

  it('emits exactly one tag when the entry is a single file', () => {
    const tmp = makeTmp('single')
    fs.writeFileSync(path.join(tmp, 'popup.js'), 'console.log(1)')
    const htmlPath = path.join(tmp, 'popup.html')
    fs.writeFileSync(
      htmlPath,
      '<html><body><script async src="./popup.js"></script></body></html>'
    )

    const updated = patchHtml(
      makeCompilation('production'),
      'action/index',
      htmlPath,
      {'action/index': htmlPath},
      tmp
    )

    const tags = scriptTags(updated)
    expect(tags.map(srcOf)).toEqual(['/action/index.js'])
    expect(tags[0]).toMatch(/\sasync(=""|\s|>)/)
  })

  it('leaves a nested page alone: its own tags stay, no sibling is added', () => {
    const tmp = makeTmp('nested')
    const htmlPath = path.join(tmp, 'nested', 'index.html')
    fs.mkdirSync(path.dirname(htmlPath), {recursive: true})
    fs.writeFileSync(
      htmlPath,
      '<html><body><script type="module" src="/action/index.js"></script></body></html>'
    )

    const updated = patchHtmlNested(
      makeCompilation('production'),
      htmlPath,
      tmp
    )

    expect(scriptTags(updated).map(srcOf)).toEqual(['/action/index.js'])
    expect(updated).not.toContain('shared/')
  })
})

describe('siblingScriptsFor', () => {
  function compilationWithEntry(
    feature: string,
    files: string[],
    entryFile?: string
  ): Compilation {
    return {
      entrypoints: new Map([
        [
          feature,
          {
            getFiles: () => files,
            getEntrypointChunk: () =>
              entryFile ? {files: new Set([entryFile])} : null
          }
        ]
      ])
    } as unknown as Compilation
  }

  it('lists the root-absolute sibling files in load order, entry excluded', () => {
    const compilation = compilationWithEntry(
      'action/index',
      [
        'shared/framework.js',
        'shared/commons.js',
        'action/index.js',
        'action/index.css'
      ],
      'action/index.js'
    )
    expect(siblingScriptsFor(compilation, 'action/index')).toEqual([
      '/shared/framework.js',
      '/shared/commons.js'
    ])
  })

  it('is empty for a single-file entry, an unknown entry or no chunk graph', () => {
    expect(
      siblingScriptsFor(
        compilationWithEntry('action/index', ['action/index.js']),
        'action/index'
      )
    ).toEqual([])
    expect(
      siblingScriptsFor(
        compilationWithEntry('action/index', ['a.js', 'b.js']),
        'options/index'
      )
    ).toEqual([])
    expect(siblingScriptsFor({} as Compilation, 'action/index')).toEqual([])
  })
})
