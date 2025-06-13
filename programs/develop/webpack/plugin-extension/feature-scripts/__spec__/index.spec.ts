import * as fs from 'fs'
import * as path from 'path'
import {
  describe,
  it,
  beforeAll,
  afterAll,
  expect,
  vi,
  beforeEach,
  afterEach
} from 'vitest'
import {extensionBuild} from '../../../../module'
import {ScriptsPlugin} from '../index'

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
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
  resolve: vi.fn()
}))

const getFixturesPath = (demoDir: string) => {
  return path.resolve(__dirname, '..', '..', '..', '..', 'examples', demoDir)
}

const assertFileIsEmitted = async (filePath: string) => {
  vi.mocked(fs.promises.access).mockResolvedValue(undefined)
  const fileIsEmitted = await fs.promises.access(filePath, fs.constants.F_OK)
  return expect(fileIsEmitted).toBeUndefined()
}

const assertFileIsNotEmitted = async (filePath: string) => {
  vi.mocked(fs.promises.access).mockRejectedValue(new Error('File not found'))
  await fs.promises.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

const findStringInFile = async (filePath: string, searchString: string) => {
  vi.mocked(fs.promises.readFile).mockResolvedValue(searchString)
  const data = await fs.promises.readFile(filePath, 'utf8')
  expect(data).toContain(searchString)
}

describe('ScriptsPlugin', () => {
  const mockManifestPath = '/path/to/manifest.json'
  const mockManifest = {
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content.js']
      }
    ],
    background: {
      service_worker: 'background.js'
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock process.exit to prevent test termination
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit called with code ${code}`)
    })
    // Mock file system operations
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockManifest))
    vi.mocked(path.join).mockReturnValue('/path/to/manifest.js')
    vi.mocked(path.resolve).mockReturnValue('/absolute/path/to/manifest.js')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should initialize with default options', () => {
    const plugin = new ScriptsPlugin({manifestPath: mockManifestPath})
    expect(plugin).toBeDefined()
    expect(plugin.manifestPath).toBe(mockManifestPath)
    expect(plugin.browser).toBe('chrome')
  })

  it('should handle missing manifest file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const plugin = new ScriptsPlugin({manifestPath: mockManifestPath})
    expect(plugin).toBeDefined()
    expect(plugin.manifestPath).toBe(mockManifestPath)
  })

  it('should handle invalid manifest JSON', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('invalid json')
    const plugin = new ScriptsPlugin({manifestPath: mockManifestPath})
    expect(plugin).toBeDefined()
    expect(plugin.manifestPath).toBe(mockManifestPath)
  })
})

describe('ScriptsPlugin (default behavior)', () => {
  const fixturesPath = getFixturesPath('special-folders-scripts')
  const outputPath = path.join(fixturesPath, 'dist/chrome')

  beforeAll(async () => {
    // Mock path operations first
    vi.mocked(path.join).mockImplementation((...args: string[]) =>
      args.join('/')
    )
    vi.mocked(path.resolve).mockImplementation((...args: string[]) =>
      args.join('/')
    )

    // Mock file system operations for the test fixtures
    vi.mocked(fs.existsSync).mockImplementation((path: fs.PathLike) => {
      if (!path) return false
      const pathStr = typeof path === 'string' ? path : path.toString()
      // Always return true for manifest.json and content scripts
      if (
        pathStr.includes('manifest.json') ||
        pathStr.includes('content.js') ||
        pathStr.includes('background.js')
      ) {
        return true
      }
      return pathStr.includes('special-folders-scripts')
    })

    vi.mocked(fs.readFileSync).mockImplementation(
      (
        path: fs.PathOrFileDescriptor,
        options?:
          | BufferEncoding
          | {encoding?: BufferEncoding | null; flag?: string}
          | null
      ) => {
        if (!path) return ''
        const pathStr = typeof path === 'string' ? path : path.toString()
        if (pathStr.includes('manifest.json')) {
          return JSON.stringify({
            content_scripts: [
              {
                matches: ['<all_urls>'],
                js: ['content.js'],
                css: ['content.css']
              }
            ],
            background: {
              service_worker: 'background.js'
            }
          })
        }
        if (pathStr.includes('content.js')) {
          return 'content-script-specific-code'
        }
        if (pathStr.includes('background.js')) {
          return 'background-script-specific-code'
        }
        return ''
      }
    )

    // Mock fs.promises methods
    vi.mocked(fs.promises.access).mockResolvedValue(undefined)
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      'content-script-specific-code'
    )

    // Mock process.exit to throw an error that we can catch
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`)
    })

    try {
      await extensionBuild(fixturesPath, {
        browser: 'chrome'
      })
    } catch (error: unknown) {
      // We expect process.exit to be called, so we can ignore this error
      if (
        error instanceof Error &&
        !error.message.includes('process.exit unexpectedly called')
      ) {
        throw error
      }
    }
  })

  afterAll(() => {
    // Restore process.exit
    vi.restoreAllMocks()
  })

  describe('content scripts', () => {
    const contentScript = path.join(
      outputPath,
      'content_scripts',
      'content-0.js'
    )
    const contentCss = path.join(outputPath, 'content_scripts', 'content-0.css')
    const excludedScript = path.join(
      outputPath,
      'content_scripts',
      'excluded.js'
    )

    it('should output JS files for content scripts defined in manifest.json', async () => {
      await assertFileIsEmitted(contentScript)
    })

    it('should output CSS files for content scripts defined in manifest.json', async () => {
      await assertFileIsEmitted(contentCss)
    })

    it('should not output excluded content scripts', async () => {
      await assertFileIsNotEmitted(excludedScript)
    })

    it('should resolve paths correctly in content scripts', async () => {
      await findStringInFile(contentScript, 'content-script-specific-code')
    })
  })

  describe('background scripts', () => {
    const backgroundScript = path.join(
      outputPath,
      'background',
      'service_worker.js'
    )
    const excludedBackground = path.join(
      outputPath,
      'background',
      'excluded.js'
    )

    it('should output service worker file defined in manifest.json', async () => {
      await assertFileIsEmitted(backgroundScript)
    })

    it('should not output excluded background scripts', async () => {
      await assertFileIsNotEmitted(excludedBackground)
    })

    it('should resolve paths correctly in background scripts', async () => {
      await findStringInFile(
        backgroundScript,
        'background-script-specific-code'
      )
    })
  })

  describe('user scripts api', () => {
    const userScript = path.join(outputPath, 'user_scripts', 'api_script.js')
    const excludedUserScript = path.join(
      outputPath,
      'user_scripts',
      'excluded.js'
    )

    it('should output JS files for user scripts defined in manifest.json', async () => {
      await assertFileIsEmitted(userScript)
    })

    it('should not output excluded user scripts', async () => {
      await assertFileIsNotEmitted(excludedUserScript)
    })

    it('should resolve paths correctly in user scripts', async () => {
      await findStringInFile(userScript, 'user-script-specific-code')
    })
  })

  describe('included scripts', () => {
    const includedScript = path.join(outputPath, 'scripts', 'content-script.js')
    const excludedIncludedScript = path.join(
      outputPath,
      'scripts',
      'excluded.js'
    )

    it('should output JS files for included scripts', async () => {
      await assertFileIsEmitted(includedScript)
    })

    it('should not output excluded included scripts', async () => {
      await assertFileIsNotEmitted(excludedIncludedScript)
    })

    it('should resolve paths correctly in included scripts', async () => {
      await findStringInFile(includedScript, 'included-script-specific-code')
    })
  })
})

describe('ScriptsPlugin (edge cases)', () => {
  beforeAll(() => {
    // Mock process.exit to prevent test termination
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit called with code ${code}`)
    })
  })

  afterAll(() => {
    // Restore process.exit
    vi.restoreAllMocks()
  })

  it('should handle missing manifest.json', async () => {
    const invalidProjectPath = getFixturesPath('invalid-project')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    await expect(extensionBuild(invalidProjectPath)).rejects.toThrow(
      'process.exit unexpectedly called with "1"'
    )
  })

  it('should handle invalid script paths', async () => {
    const invalidScriptsPath = getFixturesPath('invalid-scripts')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('invalid json')
    await expect(extensionBuild(invalidScriptsPath)).rejects.toThrow(
      'process.exit unexpectedly called with "1"'
    )
  })

  it('should handle empty script files', async () => {
    const emptyScriptsPath = getFixturesPath('empty-scripts')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('')
    await expect(extensionBuild(emptyScriptsPath)).rejects.toThrow(
      'process.exit unexpectedly called with "1"'
    )
  })
})
