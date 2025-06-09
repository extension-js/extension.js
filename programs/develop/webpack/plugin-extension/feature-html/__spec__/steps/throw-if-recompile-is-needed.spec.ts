import * as fs from 'fs'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import {ThrowIfRecompileIsNeeded} from '../../steps/throw-if-recompile-is-needed'
import {getAssetsFromHtml} from '../../html-lib/utils'
import * as utils from '../../../../lib/utils'
import * as messages from '../../../../lib/messages'

vi.mock('fs')
vi.mock('../../html-lib/utils')
vi.mock('../../../../lib/utils')
vi.mock('../../../../lib/messages')

describe('ThrowIfRecompileIsNeeded', () => {
  let compiler: any
  let makeCallback: any
  let consoleErrorSpy: any
  let consoleLogSpy: any
  let processExitSpy: any

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error')
    consoleLogSpy = vi.spyOn(console, 'log')
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({name: 'Test Extension'})
    )
    vi.mocked(utils.filterKeysForThisBrowser).mockReturnValue({
      name: 'Test Extension'
    })
    vi.mocked(messages.manifestFieldError).mockReturnValue(
      'Manifest error message'
    )
    vi.mocked(messages.serverRestartRequiredFromHtml).mockReturnValue(
      'Restart required message'
    )

    compiler = {
      hooks: {
        make: {
          tapAsync: (_name: string, fn: any) => {
            makeCallback = fn
          }
        }
      },
      modifiedFiles: new Set<string>()
    }
  })

  it('should store initial HTML assets', () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js'],
      css: ['styles.css'],
      static: []
    })

    plugin.apply(compiler)

    expect(fs.existsSync).toHaveBeenCalledWith('resource.html')
    expect(getAssetsFromHtml).toHaveBeenCalledWith('resource.html')
  })

  it('should detect changes in JS entries', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    // Initial assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js'],
      css: ['styles.css'],
      static: []
    })

    plugin.apply(compiler)

    // Modified assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js', 'new.js'],
      css: ['styles.css'],
      static: []
    })

    compiler.modifiedFiles = new Set(['resource.html'])
    await makeCallback({}, () => {})

    expect(consoleLogSpy).toHaveBeenCalledWith('Restart required message')
  })

  it('should detect changes in CSS entries', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    // Initial assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js'],
      css: ['styles.css'],
      static: []
    })

    plugin.apply(compiler)

    // Modified assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js'],
      css: ['styles.css', 'new.css'],
      static: []
    })

    compiler.modifiedFiles = new Set(['resource.html'])
    await makeCallback({}, () => {})

    expect(consoleLogSpy).toHaveBeenCalledWith('Restart required message')
  })

  it('should handle missing HTML files', () => {
    const includeList = {feature: 'missing.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(fs.existsSync).mockReturnValue(false)

    plugin.apply(compiler)

    expect(consoleErrorSpy).toHaveBeenCalledWith('Manifest error message')
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  it('should not detect changes when assets are the same', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    const assets = {
      js: ['app.js'],
      css: ['styles.css'],
      static: []
    }

    vi.mocked(getAssetsFromHtml).mockReturnValue(assets)

    plugin.apply(compiler)

    compiler.modifiedFiles = new Set(['resource.html'])
    await makeCallback({}, () => {})

    expect(consoleLogSpy).not.toHaveBeenCalled()
  })

  it('should handle multiple HTML files', async () => {
    const includeList = {
      feature1: 'resource1.html',
      feature2: 'resource2.html'
    }
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    // Initial assets
    vi.mocked(getAssetsFromHtml).mockImplementation((resource) => {
      if (resource === 'resource1.html') {
        return {
          js: ['app1.js'],
          css: ['styles1.css'],
          static: []
        }
      }
      return {
        js: ['app2.js'],
        css: ['styles2.css'],
        static: []
      }
    })

    plugin.apply(compiler)

    // Modified assets
    vi.mocked(getAssetsFromHtml).mockImplementation((resource) => {
      if (resource === 'resource1.html') {
        return {
          js: ['app1.js', 'new.js'],
          css: ['styles1.css'],
          static: []
        }
      }
      return {
        js: ['app2.js'],
        css: ['styles2.css'],
        static: []
      }
    })

    compiler.modifiedFiles = new Set(['resource1.html'])
    await makeCallback({}, () => {})

    expect(consoleLogSpy).toHaveBeenCalledWith('Restart required message')
  })

  it('should handle empty modified files', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js'],
      css: ['styles.css'],
      static: []
    })

    plugin.apply(compiler)

    compiler.modifiedFiles = new Set()
    await makeCallback({}, () => {})

    expect(consoleLogSpy).not.toHaveBeenCalled()
  })

  it('should handle invalid manifest JSON', () => {
    const includeList = {feature: 'missing.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.readFileSync).mockReturnValue('invalid json')

    expect(() => {
      plugin.apply(compiler)
    }).toThrow()
  })

  it('should handle missing manifest file', () => {
    const includeList = {feature: 'missing.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    expect(() => {
      plugin.apply(compiler)
    }).toThrow('ENOENT')
  })

  it('should handle undefined resources in includeList', () => {
    const includeList = {
      feature1: 'resource1.html',
      feature2: undefined
    }
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js'],
      css: ['styles.css'],
      static: []
    })

    plugin.apply(compiler)

    expect(fs.existsSync).toHaveBeenCalledWith('resource1.html')
    expect(fs.existsSync).not.toHaveBeenCalledWith(undefined)
  })

  it('should handle empty asset lists', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    // Initial assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: [],
      css: [],
      static: []
    })

    plugin.apply(compiler)

    // Modified assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['new.js'],
      css: [],
      static: []
    })

    compiler.modifiedFiles = new Set(['resource.html'])
    await makeCallback({}, () => {})

    expect(consoleLogSpy).toHaveBeenCalledWith('Restart required message')
  })

  it('should handle assets with query parameters', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    // Initial assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js?v=123'],
      css: ['styles.css?v=456'],
      static: []
    })

    plugin.apply(compiler)

    // Modified assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js?v=789'],
      css: ['styles.css?v=012'],
      static: []
    })

    compiler.modifiedFiles = new Set(['resource.html'])
    await makeCallback({}, () => {})

    expect(consoleLogSpy).toHaveBeenCalledWith('Restart required message')
  })

  it('should handle assets with hash fragments', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    // Initial assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js#hash1'],
      css: ['styles.css#hash2'],
      static: []
    })

    plugin.apply(compiler)

    // Modified assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js#hash3'],
      css: ['styles.css#hash4'],
      static: []
    })

    compiler.modifiedFiles = new Set(['resource.html'])
    await makeCallback({}, () => {})

    expect(consoleLogSpy).toHaveBeenCalledWith('Restart required message')
  })

  it('should handle empty includeList', () => {
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList: {}
    })

    plugin.apply(compiler)

    expect(fs.existsSync).not.toHaveBeenCalled()
    expect(getAssetsFromHtml).not.toHaveBeenCalled()
  })

  it('should handle non-string resource paths', () => {
    const includeList = {
      feature1: 'resource1.html',
      feature2: 123 as any
    }
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js'],
      css: ['styles.css'],
      static: []
    })

    plugin.apply(compiler)

    // Reset the mock to clear previous calls
    vi.clearAllMocks()

    // Call apply again to verify behavior
    plugin.apply(compiler)

    expect(fs.existsSync).toHaveBeenCalledWith('resource1.html')
    expect(fs.existsSync).not.toHaveBeenCalledWith(123)
  })

  it('should handle multiple modified files', async () => {
    const includeList = {
      feature1: 'resource1.html',
      feature2: 'resource2.html'
    }
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    // Initial assets
    vi.mocked(getAssetsFromHtml).mockImplementation((resource) => {
      if (resource === 'resource1.html') {
        return {
          js: ['app1.js'],
          css: ['styles1.css'],
          static: []
        }
      }
      return {
        js: ['app2.js'],
        css: ['styles2.css'],
        static: []
      }
    })

    plugin.apply(compiler)

    // Modified assets
    vi.mocked(getAssetsFromHtml).mockImplementation((resource) => {
      if (resource === 'resource1.html') {
        return {
          js: ['app1.js', 'new.js'],
          css: ['styles1.css'],
          static: []
        }
      }
      return {
        js: ['app2.js', 'new.js'],
        css: ['styles2.css'],
        static: []
      }
    })

    compiler.modifiedFiles = new Set(['resource1.html', 'resource2.html'])
    await makeCallback({}, () => {})

    expect(consoleLogSpy).toHaveBeenCalledWith('Restart required message')
  })

  it('should handle assets with special characters in filenames', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    // Initial assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app with spaces.js'],
      css: ['styles@2x.css'],
      static: []
    })

    plugin.apply(compiler)

    // Modified assets
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app with spaces.js', 'new file.js'],
      css: ['styles@2x.css'],
      static: []
    })

    compiler.modifiedFiles = new Set(['resource.html'])
    await makeCallback({}, () => {})

    expect(consoleLogSpy).toHaveBeenCalledWith('Restart required message')
  })

  it('should handle compilation errors', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js'],
      css: ['styles.css'],
      static: []
    })

    plugin.apply(compiler)

    compiler.modifiedFiles = new Set(['resource.html'])
    await makeCallback({errors: ['Some error']}, () => {})

    expect(consoleLogSpy).not.toHaveBeenCalled()
  })

  it('should skip non-string resource paths when checking for recompilation', () => {
    const includeList = {
      feature1: 'resource1.html',
      feature2: 123 as any
    }
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['app.js'],
      css: ['styles.css'],
      static: []
    })

    plugin.apply(compiler)

    // Reset the mock to clear previous calls
    vi.clearAllMocks()

    // Call apply again to verify behavior
    plugin.apply(compiler)

    expect(fs.existsSync).toHaveBeenCalledWith('resource1.html')
    expect(fs.existsSync).not.toHaveBeenCalledWith(123)
  })
})
