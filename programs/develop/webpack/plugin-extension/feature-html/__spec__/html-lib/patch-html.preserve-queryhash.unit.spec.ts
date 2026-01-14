import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
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
  it('rewrites relative static asset to /assets/... and preserves ?query/#hash', () => {
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
        {}
      )

      expect(updatedHtml).toContain(`src="/assets/img/a.png?x=1#h"`)
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
        {}
      )

      expect(updatedHtml).toContain(`href="/public/x.css?ver=123#sec"`)
      expect(updatedHtml).toContain(`src="/public/x.js?v=1#h"`)
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })
})
