import {describe, it, expect, vi, afterEach} from 'vitest'
import fs from 'node:fs'
import {resolveModuleEntry} from '../utils'

const toPosix = (value: string) => value.replace(/\\/g, '/')

describe('dlx / resolveModuleEntry', () => {
  const modulePath = '/tmp/extension-develop'

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers pkgJson.main when present', () => {
    const href = resolveModuleEntry(modulePath, {
      main: './dist/module.js'
    })
    expect(href).toBeDefined()
    expect(href).toContain('dist/module.js')
  })

  it('supports string exports field', () => {
    const href = resolveModuleEntry(modulePath, {
      exports: './dist/index.js'
    })
    expect(href).toBeDefined()
    expect(href).toContain('dist/index.js')
  })

  it('supports exports object with string "."', () => {
    const href = resolveModuleEntry(modulePath, {
      exports: {
        '.': './dist/index.js'
      }
    })
    expect(href).toBeDefined()
    expect(href).toContain('dist/index.js')
  })

  it('supports exports object with conditional "." (import/require)', () => {
    const href = resolveModuleEntry(modulePath, {
      exports: {
        '.': {
          import: './dist/module.mjs',
          require: './dist/module.cjs'
        }
      }
    })
    expect(href).toBeDefined()
    expect(href).toContain('dist/module.mjs')
  })

  it('falls back to common filenames when main/exports are missing', () => {
    const spy = vi
      .spyOn(fs, 'existsSync')
      .mockImplementation((p: any) =>
        typeof p === 'string' ? toPosix(p).endsWith('dist/module.cjs') : false
      )

    const href = resolveModuleEntry(modulePath, {
      name: 'extension-develop'
    })

    expect(spy).toHaveBeenCalled()
    expect(href).toBeDefined()
    expect(href).toContain('dist/module.cjs')
  })
})
