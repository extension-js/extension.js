import {describe, it, expect} from 'vitest'
import * as messages from '../messages'

describe('Messages', () => {
  describe('portManagerErrorAllocatingPorts', () => {
    it('formats basic error messages correctly', () => {
      const error = new Error('Test error message')
      const result = messages.portManagerErrorAllocatingPorts(error)

      expect(result).toContain('Port Manager')
      expect(result).toContain('Failed to allocate ports')
      expect(result).toContain('Test error message')
    })

    it('provides specific guidance for ENOENT errors', () => {
      const error = new Error('ENOENT: no such file or directory')
      const result = messages.portManagerErrorAllocatingPorts(error)

      expect(result).toContain(
        'extension-js data directory could not be created'
      )
      expect(result).toContain(
        'Check if you have write permissions to your home directory'
      )
      expect(result).toContain('Try running: extension cleanup')
      expect(result).toContain(
        'Manually delete: ~/Library/Application Support/extension-js (macOS)'
      )
      expect(result).toContain('Restart your terminal and try again')
    })

    it('handles non-ENOENT errors without additional guidance', () => {
      const error = new Error('EACCES: permission denied')
      const result = messages.portManagerErrorAllocatingPorts(error)

      expect(result).toContain('EACCES: permission denied')
      expect(result).not.toContain(
        'extension-js data directory could not be created'
      )
      expect(result).not.toContain('Check if you have write permissions')
    })

    it('handles string errors correctly', () => {
      const error = 'Custom error string'
      const result = messages.portManagerErrorAllocatingPorts(error)

      expect(result).toContain('Custom error string')
    })

    it('handles undefined errors gracefully', () => {
      const result = messages.portManagerErrorAllocatingPorts(undefined)

      expect(result).toContain('Port Manager')
      expect(result).toContain('Failed to allocate ports')
      expect(result).toContain('undefined')
    })
  })
})
