import {describe, expect, it} from 'vitest'
import {codedError} from '../coded-error'
import {diagnosticCode} from '../diagnostic-code'
import {CODES} from '../messaging'

describe('codedError', () => {
  it('is an Error that carries the code and the human line', () => {
    const error = codedError(CODES.E_MANIFEST_INVALID, 'manifest.json is bad')

    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('E_MANIFEST_INVALID')
    expect(error.message).toBe('manifest.json is bad')
    expect(error.name).toBe('Error')
    expect(String(error.stack)).toContain('coded-error.spec')
  })

  it('throws and is caught with the code still on it', () => {
    const refuse = () => {
      throw codedError(CODES.E_INVALID_OPTION, 'no such option')
    }

    expect(refuse).toThrow('no such option')

    try {
      refuse()
    } catch (error) {
      expect((error as {code?: string}).code).toBe('E_INVALID_OPTION')
    }
  })

  it('is read by the diagnostic table as the code it declares', () => {
    const error = codedError(CODES.E_MANIFEST_INVALID, 'Module not found: x')

    // The text alone would read as a missing module: the declared code wins.
    expect(diagnosticCode(new Error('Module not found: x'))).toBe(
      'E_MODULE_NOT_FOUND'
    )

    expect(diagnosticCode(error)).toBe('E_MANIFEST_INVALID')
  })
})
