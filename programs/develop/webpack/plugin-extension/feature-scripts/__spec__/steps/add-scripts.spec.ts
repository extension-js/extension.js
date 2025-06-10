import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {AddScripts} from '../../steps/add-scripts'
import {type Compiler, type EntryObject} from '@rspack/core'
import * as fs from 'fs'
import * as path from 'path'

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  constants: {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1
  },
  promises: {
    access: vi.fn(),
    readFile: vi.fn()
  }
}))

// Mock path module
vi.mock('path', () => ({
  join: vi.fn(),
  dirname: vi.fn(),
  resolve: vi.fn(),
  normalize: vi.fn((path) => path),
  extname: vi.fn((path) => {
    const ext = path.split('.').pop()
    return ext ? `.${ext}` : ''
  })
}))

describe('AddScripts', () => {
  const mockManifestPath = '/path/to/manifest.json'

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock process.exit to prevent test termination
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`)
    })
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(path.dirname).mockReturnValue('/path/to')
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'))
    vi.mocked(path.resolve).mockImplementation((...args) => args.join('/'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should process included scripts with absolute paths', () => {
    const compiler = {
      options: {
        entry: {}
      }
    } as unknown as Compiler

    const addScripts = new AddScripts({
      manifestPath: mockManifestPath,
      includeList: {
        'content_scripts/content-0': '/absolute/path/to/content.js'
      }
    })
    addScripts.apply(compiler)

    const entry = compiler.options.entry as EntryObject
    expect(entry).toHaveProperty('content_scripts/content-0')
    expect(entry['content_scripts/content-0']).toEqual({
      import: ['/absolute/path/to/content.js']
    })
  })

  it('should handle empty included scripts', () => {
    const compiler = {
      options: {
        entry: {}
      }
    } as unknown as Compiler

    const addScripts = new AddScripts({
      manifestPath: mockManifestPath,
      includeList: {}
    })
    addScripts.apply(compiler)

    expect(compiler.options.entry).toEqual({})
  })

  it('should preserve existing entries', () => {
    const compiler = {
      options: {
        entry: {
          'existing-entry': {import: ['existing.js']}
        }
      }
    } as unknown as Compiler

    const addScripts = new AddScripts({
      manifestPath: mockManifestPath,
      includeList: {
        'content_scripts/content-0': '/path/to/content.js'
      }
    })
    addScripts.apply(compiler)

    const entry = compiler.options.entry as EntryObject
    expect(entry).toHaveProperty('existing-entry')
    expect(entry['existing-entry']).toEqual({
      import: ['existing.js']
    })
    expect(entry).toHaveProperty('content_scripts/content-0')
    expect(entry['content_scripts/content-0']).toEqual({
      import: ['/path/to/content.js']
    })
  })
})
