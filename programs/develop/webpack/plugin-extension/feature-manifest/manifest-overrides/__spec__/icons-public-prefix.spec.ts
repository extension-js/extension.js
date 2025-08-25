import {describe, it, expect} from 'vitest'
import {getFilename} from '../../../../webpack-lib/utils'

// Ensure getFilename respects excludeList mappings for public/ assets
describe('manifest overrides – getFilename with public/ prefix', () => {
  it('derives output path from excludeList mapping key for public assets', () => {
    const excludeList = {'public/icon-maro.png': '/abs/public/icon-maro.png'}
    const out = getFilename(
      'icons/icon-maro.png',
      '/abs/public/icon-maro.png',
      excludeList as any
    )
    expect(out).toBe('icon-maro.png')
  })

  it('normalizes "/public/" input to strip to root file path', () => {
    const excludeList = {'/public/icon-maro.png': '/abs/public/icon-maro.png'}
    const out = getFilename(
      'icons/icon-maro.png',
      '/abs/public/icon-maro.png',
      excludeList as any
    )
    expect(out).toBe('icon-maro.png')
  })

  it('normalizes leading "/" (implicit public root) to root file path', () => {
    const excludeList = {'/icon-maro.png': '/abs/public/icon-maro.png'}
    const out = getFilename(
      'icons/icon-maro.png',
      '/abs/public/icon-maro.png',
      excludeList as any
    )
    expect(out).toBe('icon-maro.png')
  })
})
