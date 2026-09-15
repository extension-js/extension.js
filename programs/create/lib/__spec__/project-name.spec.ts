import {describe, expect, it} from 'vitest'
import {isUrlProjectName} from '../project-name'

describe('isUrlProjectName', () => {
  it('refuses an http or https URL in any case', () => {
    expect(isUrlProjectName('http://example.com')).toBe(true)
    expect(isUrlProjectName('https://github.com/extension-js/examples')).toBe(
      true
    )
    expect(isUrlProjectName('HTTPS://example.com/x.zip')).toBe(true)
    expect(isUrlProjectName('  https://example.com')).toBe(true)
  })

  it('accepts project names that only start with http', () => {
    expect(isUrlProjectName('httpbin-tool')).toBe(false)
    expect(isUrlProjectName('http-client-devtools')).toBe(false)
    expect(isUrlProjectName('https-everywhere-fork')).toBe(false)
    expect(isUrlProjectName('http')).toBe(false)
    expect(isUrlProjectName('./https-a')).toBe(false)
  })
})
