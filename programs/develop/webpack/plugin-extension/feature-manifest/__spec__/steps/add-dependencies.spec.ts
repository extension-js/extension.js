let existsSyncImpl: (filePath: string) => boolean = () => true

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    existsSync: vi.fn((filePath: string) => existsSyncImpl(String(filePath)))
  }
})

import * as fs from 'fs'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {AddDependencies} from '../../steps/add-dependencies'
import {type Compiler, type Compilation, WebpackError} from '@rspack/core'

describe('AddDependencies', () => {
  const mockContext = '/mock/context'
  const mockDependencies = [
    path.join(mockContext, 'file1.js'),
    path.join(mockContext, 'file2.js'),
    path.join(mockContext, 'non-existent.js')
  ]

  let mockCompilation: Compilation
  let mockCompiler: Compiler

  beforeEach(() => {
    existsSyncImpl = (filePath: string) =>
      filePath !== path.join(mockContext, 'non-existent.js')
    // Mock compilation
    mockCompilation = {
      errors: [],
      fileDependencies: new Set([path.join(mockContext, 'existing.js')])
    } as unknown as Compilation

    // Mock compiler
    mockCompiler = {
      hooks: {
        afterCompile: {
          tap: vi.fn((name, callback) => {
            callback(mockCompilation)
          })
        }
      }
    } as unknown as Compiler
  })

  afterEach(() => {
    // no fs restore needed
  })

  it('should add existing dependencies to compilation', () => {
    const addDependencies = new AddDependencies(mockDependencies)
    addDependencies.apply(mockCompiler)

    expect(mockCompilation.fileDependencies).toContain(mockDependencies[0])
    expect(mockCompilation.fileDependencies).toContain(mockDependencies[1])
    expect(mockCompilation.fileDependencies).not.toContain(mockDependencies[2])
  })

  it('should not add dependencies if compilation has errors', () => {
    mockCompilation.errors = [new WebpackError('Some error')]
    const addDependencies = new AddDependencies(mockDependencies)
    addDependencies.apply(mockCompiler)

    expect(mockCompilation.fileDependencies).not.toContain(mockDependencies[0])
    expect(mockCompilation.fileDependencies).not.toContain(mockDependencies[1])
  })

  it('should not add non-existent files to dependencies', () => {
    const addDependencies = new AddDependencies(mockDependencies)
    addDependencies.apply(mockCompiler)

    expect(mockCompilation.fileDependencies).not.toContain(mockDependencies[2])
  })

  it('should not add duplicate dependencies', () => {
    mockCompilation.fileDependencies.add(mockDependencies[0])
    const addDependencies = new AddDependencies(mockDependencies)
    addDependencies.apply(mockCompiler)

    const dependencies = Array.from(mockCompilation.fileDependencies)
    expect(dependencies.filter((d) => d === mockDependencies[0]).length).toBe(1)
  })
})
