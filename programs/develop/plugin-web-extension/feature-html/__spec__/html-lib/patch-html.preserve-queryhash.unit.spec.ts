import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {bundledAssetOutputName} from '../../../../plugin-static-assets/static-assets-lib/asset-output-name'
import {patchHtml} from '../../html-lib/patch-html'

function makeCompilation(mode: 'development' | 'production') {
  return {
    options: {mode},
    getAsset: (_: string) => undefined,
    emitAsset() {},
    updateAsset() {},
    warnings: [] as any[]
  } as any
}

describe('patchHtml (preserve query/hash)', () => {
  it('rewrites a relative static asset to its bundled name and preserves ?query/#hash', () => {
    const tmpDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feature-html-patch-qh-')
    )

    try {
      const htmlFilePath = path.join(tmpDirectoryPath, 'index.html')
      const imageDirectoryPath = path.join(tmpDirectoryPath, 'img')
      fs.mkdirSync(imageDirectoryPath, {recursive: true})

      const imageFilePath = path.join(imageDirectoryPath, 'a.png')
      fs.writeFileSync(imageFilePath, 'x')

      fs.writeFileSync(
        htmlFilePath,
        `<html><head></head><body><img src="img/a.png?x=1#h"></body></html>`,
        'utf8'
      )

      const updatedHtml = patchHtml(
        makeCompilation('production') as any,
        'feature/index',
        htmlFilePath,
        {'feature/index': htmlFilePath},
        undefined
      )

      const emitted = bundledAssetOutputName(imageFilePath, Buffer.from('x'))

      expect(emitted).toMatch(/^assets\/a\.[0-9a-f]{8}\.png$/)
      expect(updatedHtml).toContain(`src="/${emitted}?x=1#h"`)
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })

  it('preserves query/hash for public-root absolute URLs as-is', () => {
    const tmpDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feature-html-patch-public-qh-')
    )

    try {
      const htmlFilePath = path.join(tmpDirectoryPath, 'index.html')
      fs.writeFileSync(
        htmlFilePath,
        `<html><head><link rel="stylesheet" href="/public/x.css?ver=123#sec"></head><body><script src="/public/x.js?v=1#h"></script></body></html>`,
        'utf8'
      )

      const updatedHtml = patchHtml(
        makeCompilation('production') as any,
        'feature/index',
        htmlFilePath,
        {'feature/index': htmlFilePath},
        undefined
      )

      expect(updatedHtml).toContain(`href="/public/x.css?ver=123#sec"`)
      expect(updatedHtml).toContain(`src="/public/x.js?v=1#h"`)
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })
})
