import {describe, expect, it} from 'vitest'
import {resolveDtsGeneration} from '../rslib.config'

const broken = () => {
  throw new Error('Cannot find native binding.\nRequire stack: ...')
}

describe('the build writes type declarations or stops', () => {
  it('generates them when the native parser loads', () => {
    expect(resolveDtsGeneration(() => ({}), {})).toBe(true)
  })

  it('stops the build when the native parser cannot load', () => {
    expect(() => resolveDtsGeneration(broken, {})).toThrow(
      /Type declarations cannot be generated: @ast-grep\/napi failed to load\.\nCannot find native binding\.\nReinstall the dependencies, or set EXTENSION_SKIP_DTS=1/
    )
  })

  it('builds without them only when asked to, and never tries the parser then', () => {
    expect(resolveDtsGeneration(broken, {EXTENSION_SKIP_DTS: '1'})).toBe(false)
    expect(() =>
      resolveDtsGeneration(broken, {EXTENSION_SKIP_DTS: 'true'})
    ).toThrow()
  })
})
