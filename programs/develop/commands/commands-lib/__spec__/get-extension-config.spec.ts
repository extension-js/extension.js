import {describe, it, expect, vi} from 'vitest'
import {pathToFileURL} from 'url'
import * as path from 'path'
import * as fs from 'fs'

describe('ESM Import Compatibility', () => {
  it('should convert paths to file:// URLs correctly', () => {
    const testCases = [
      {
        input: path.join(process.cwd(), 'extension.config.js'),
        expected: `file://${path.resolve(process.cwd(), 'extension.config.js')}`
      }
      // Removed new-config-babel example
    ]

    testCases.forEach(({input, expected}) => {
      const result = pathToFileURL(input).href
      expect(result).toBe(expected)
    })
  })

  it('should handle absolute paths correctly', () => {
    const absolutePath = path.resolve(process.cwd(), 'extension.config.js')
    const expected = `file://${absolutePath}`

    const result = pathToFileURL(absolutePath).href
    expect(result).toBe(expected)
  })

  it('should handle relative paths correctly', () => {
    const relativePath = './extension.config.js'
    const expected = `file://${path.resolve(process.cwd(), relativePath)}`

    const result = pathToFileURL(relativePath).href
    expect(result).toBe(expected)
  })

  it('supports browser.reuseProfile flag when present', async () => {
    const fileConfig = {
      browser: {chrome: {browser: 'chrome', reuseProfile: true}},
      commands: {dev: {browser: 'chrome'}},
      config: (c: any) => c
    } as any
    const tmp = path.join(process.cwd(), '.tmp-config')
    fs.mkdirSync(tmp, {recursive: true})
    const cfg = path.join(tmp, 'extension.config.js')
    fs.writeFileSync(
      cfg,
      'export default ' + JSON.stringify(fileConfig),
      'utf-8'
    )
    const {loadBrowserConfig} = await import('../get-extension-config')
    const res = await loadBrowserConfig(tmp, 'chrome')
    expect((res as any).reuseProfile).toBe(true)
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('should handle paths with special characters correctly', () => {
    const pathWithSpaces = path.join(
      process.cwd(),
      'test folder',
      'extension.config.js'
    )
    const expected = `file://${path
      .resolve(process.cwd(), 'test folder', 'extension.config.js')
      .replace(/ /g, '%20')}`

    const result = pathToFileURL(pathWithSpaces).href
    expect(result).toBe(expected)
  })
})
