import {describe, it, expect, vi} from 'vitest'
import {pathToFileURL} from 'url'

describe('Windows ESM Import Compatibility', () => {
  it('should convert Windows paths to file:// URLs correctly', () => {
    // Mock process.platform to simulate Windows
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true
    })

    try {
      // Test various Windows path formats
      const testCases = [
        {
          input: 'C:\\Users\\test\\extension.config.js',
          expected: 'file:///C:/Users/test/extension.config.js'
        },
        {
          input: 'D:\\Projects\\my-extension\\extension.config.js',
          expected: 'file:///D:/Projects/my-extension/extension.config.js'
        },
        {
          input:
            'C:\\Users\\55219\\local\\extension.js.org\\new-config-babel\\extension.config.js',
          expected:
            'file:///C:/Users/55219/local/extension.js.org/new-config-babel/extension.config.js'
        }
      ]

      testCases.forEach(({input, expected}) => {
        const result = pathToFileURL(input).href
        expect(result).toBe(expected)
      })
    } finally {
      // Restore original platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true
      })
    }
  })

  it('should convert Unix paths to file:// URLs correctly', () => {
    // Mock process.platform to simulate Unix
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      writable: true
    })

    try {
      // Test various Unix path formats
      const testCases = [
        {
          input: '/home/user/extension.config.js',
          expected: 'file:///home/user/extension.config.js'
        },
        {
          input:
            '/Users/cezaraugusto/local/extension-land/extension.js/examples/new-config-babel/extension.config.js',
          expected:
            'file:///Users/cezaraugusto/local/extension-land/extension.js/examples/new-config-babel/extension.config.js'
        }
      ]

      testCases.forEach(({input, expected}) => {
        const result = pathToFileURL(input).href
        expect(result).toBe(expected)
      })
    } finally {
      // Restore original platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true
      })
    }
  })

  it('should handle macOS paths correctly', () => {
    // Mock process.platform to simulate macOS
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true
    })

    try {
      const input =
        '/Users/cezaraugusto/local/extension-land/extension.js/examples/new-config-babel/extension.config.js'
      const expected =
        'file:///Users/cezaraugusto/local/extension-land/extension.js/examples/new-config-babel/extension.config.js'

      const result = pathToFileURL(input).href
      expect(result).toBe(expected)
    } finally {
      // Restore original platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true
      })
    }
  })
})
