import {describe, it, expect, vi} from 'vitest'
import {pathToFileURL} from 'url'
import * as path from 'path'

describe('ESM Import Compatibility', () => {
  it('should convert paths to file:// URLs correctly', () => {
    // Test with actual platform-appropriate paths
    const testCases = [
      {
        input: path.join(process.cwd(), 'extension.config.js'),
        expected: `file://${path.resolve(process.cwd(), 'extension.config.js')}`
      },
      {
        input: path.join(
          process.cwd(),
          'examples',
          'new-config-babel',
          'extension.config.js'
        ),
        expected: `file://${path.resolve(process.cwd(), 'examples', 'new-config-babel', 'extension.config.js')}`
      }
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

  it('should handle paths with special characters correctly', () => {
    const pathWithSpaces = path.join(
      process.cwd(),
      'test folder',
      'extension.config.js'
    )
    const expected = `file://${path.resolve(process.cwd(), 'test folder', 'extension.config.js').replace(/ /g, '%20')}`

    const result = pathToFileURL(pathWithSpaces).href
    expect(result).toBe(expected)
  })
})
