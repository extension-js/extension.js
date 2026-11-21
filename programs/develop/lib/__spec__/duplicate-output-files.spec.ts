import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from '../../__spec__/helpers/build-project'
import {
  writeExtensionProject,
  writeProjectFiles
} from '../../__spec__/helpers/extension-project'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import type {BuildSummary} from '../build-summary'
import {
  findDuplicateOutputFiles,
  importedAssetSources
} from '../duplicate-output-files'
import * as messages from '../messages'
import {listOutputFiles} from '../output-files'

const tempFolder = trackTempFolders()

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

const BIG = 300 * 1024

function folder(files: Record<string, Buffer | string>) {
  const root = tempFolder('extjs-dupes-')

  writeProjectFiles(root, files)

  return root
}

describe('findDuplicateOutputFiles', () => {
  it('pairs byte-identical files above the threshold and nothing else', () => {
    const same = Buffer.alloc(BIG, 7)
    const other = Buffer.alloc(BIG, 8)
    const root = folder({
      'ort/ort-wasm.wasm': same,
      'assets/ort-wasm.abc123.wasm': same,
      'assets/other.wasm': other,
      'a.txt': 'x',
      'b.txt': 'x',
      'c.js': Buffer.alloc(BIG + 1, 7)
    })

    expect(findDuplicateOutputFiles(root, listOutputFiles(root))).toEqual([
      {
        names: ['assets/ort-wasm.abc123.wasm', 'ort/ort-wasm.wasm'],
        size: BIG
      }
    ])
  })

  it('reads only files whose size occurs twice above the threshold', () => {
    const root = folder({
      'one.bin': Buffer.alloc(BIG, 1),
      'two.bin': Buffer.alloc(BIG + 5, 1),
      'small-a.bin': Buffer.alloc(10, 1),
      'small-b.bin': Buffer.alloc(10, 1)
    })

    expect(findDuplicateOutputFiles(root, listOutputFiles(root))).toEqual([])
    // A lower threshold reaches the small pair.
    expect(findDuplicateOutputFiles(root, listOutputFiles(root), 1)).toEqual([
      {names: ['small-a.bin', 'small-b.bin'], size: 10}
    ])
  })

  it('reads the import source off the asset the bundler emitted', () => {
    const compilation = {
      getAsset: (name: string) =>
        name === 'assets/x.wasm'
          ? {info: {sourceFilename: 'node_modules/x/x.wasm'}}
          : {info: {}}
    }

    expect(
      importedAssetSources(compilation, [
        {names: ['assets/x.wasm', 'copy/x.wasm'], size: 1}
      ])
    ).toEqual(new Map([['assets/x.wasm', 'node_modules/x/x.wasm']]))
  })
})

describe('the duplicate files warning', () => {
  const group = {
    names: ['assets/ort-wasm.abc123.wasm', 'ort/ort-wasm.wasm'],
    size: 14_848_852
  }

  it('names both paths, the size, the import and the copy', () => {
    const text = stripAnsi(
      messages.duplicateOutputFiles(
        'dist/chrome',
        group,
        new Map([
          ['assets/ort-wasm.abc123.wasm', 'node_modules/onnxruntime-web/x.wasm']
        ])
      )
    )

    expect(text).toContain(
      'assets/ort-wasm.abc123.wasm and ort/ort-wasm.wasm in dist/chrome are the same 14.2 MB, byte for byte, so the package carries that file twice.'
    )

    expect(text).toContain(
      'assets/ort-wasm.abc123.wasm comes from the import of node_modules/onnxruntime-web/x.wasm, so ort/ort-wasm.wasm is a copy a config plugin or public/ added.'
    )

    expect(text).toContain('Drop the copy to shrink the package.')
  })

  it('names no cause when neither file came from an import', () => {
    const text = stripAnsi(
      messages.duplicateOutputFiles('dist/chrome', group, new Map())
    )

    expect(text).not.toContain('comes from the import')
    expect(text).toContain('Drop one of them to shrink the package.')
  })
})

describe('a production build with the same bytes under two names', () => {
  it('warns once with both paths and records it in the summary', async () => {
    const root = tempFolder('extjs-dupes-build-')
    writeExtensionProject(root, {
      name: 'dupes',
      manifest: {background: {service_worker: 'background.js'}}
    })

    fs.writeFileSync(path.join(root, 'background.js'), 'console.log("hi")\n')
    fs.mkdirSync(path.join(root, 'public', 'nested'), {recursive: true})
    const bytes = Buffer.alloc(BIG, 3)
    fs.writeFileSync(path.join(root, 'public', 'model.bin'), bytes)
    fs.writeFileSync(path.join(root, 'public', 'nested', 'model.bin'), bytes)

    let summary: BuildSummary

    summary = await buildProject(root, {mode: 'production', exitOnError: false})

    const warning = (summary.warnings || []).find((line) =>
      /byte for byte/.test(line)
    )

    expect(warning).toBeDefined()
    expect(warning).toMatch(/model\.bin and nested\/model\.bin/)
    expect(warning).toContain('the same 300.0 KB')
    expect(summary.warnings_count).toBeGreaterThanOrEqual(1)
  }, 180_000)
})
