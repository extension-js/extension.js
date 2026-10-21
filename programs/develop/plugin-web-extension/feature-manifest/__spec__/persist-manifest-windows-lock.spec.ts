import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const lock = vi.hoisted(() => ({remaining: 0, calls: 0}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  return {
    ...actual,
    renameSync(from: fs.PathLike, to: fs.PathLike) {
      if (String(to).endsWith('manifest.json')) {
        lock.calls += 1

        if (lock.remaining > 0) {
          lock.remaining -= 1

          throw Object.assign(new Error('EPERM: operation not permitted'), {
            code: 'EPERM'
          })
        }
      }

      return actual.renameSync(from, to)
    }
  }
})

const {PersistManifestToDisk} = await import('../steps/persist-manifest')

function runPersist(outputDir: string, manifestSource: string) {
  const errors: Error[] = []
  let processAssets: (() => void) | undefined
  let afterEmit: ((compilation: unknown) => void) | undefined

  const compilation = {
    errors,
    outputOptions: {path: outputDir},
    hooks: {
      processAssets: {
        tap: (_opts: unknown, fn: () => void) => {
          processAssets = fn
        }
      }
    },
    getAsset: (name: string) =>
      name === 'manifest.json'
        ? {source: {source: () => manifestSource}}
        : undefined
  }

  const compiler = {
    options: {output: {path: outputDir}},
    hooks: {
      thisCompilation: {
        tap: (_name: string, fn: (c: unknown) => void) => fn(compilation)
      },
      afterEmit: {
        tap: (_name: string, fn: (c: unknown) => void) => {
          afterEmit = fn
        }
      }
    }
  }

  new PersistManifestToDisk().apply(compiler as never)
  processAssets?.()
  afterEmit?.(compilation)

  return errors
}

describe('PersistManifestToDisk while Windows holds manifest.json open', () => {
  const realPlatform = process.platform
  let outputDir: string

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {value: 'win32'})
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-lock-'))
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), '{"name":"old"}')
    lock.remaining = 0
    lock.calls = 0
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {value: realPlatform})
    fs.rmSync(outputDir, {recursive: true, force: true})
  })

  it('writes the manifest once the browser lets go of it', () => {
    lock.remaining = 2

    const errors = runPersist(outputDir, '{"name":"new"}')

    expect(errors).toEqual([])
    expect(lock.calls).toBe(3)
    expect(
      fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8')
    ).toBe('{"name":"new"}')

    expect(
      fs.readdirSync(outputDir).filter((entry) => entry.endsWith('.tmp'))
    ).toEqual([])
  })
})
