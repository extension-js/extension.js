import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../css-tools/tailwind', () => ({
  isUsingTailwind: vi.fn(() => false)
}))

vi.mock('../css-tools/sass', () => ({
  isUsingSass: vi.fn(() => false)
}))

vi.mock('../css-tools/less', () => ({
  isUsingLess: vi.fn(() => false)
}))

vi.mock('../css-tools/postcss', () => ({
  maybeUsePostCss: vi.fn(async () => ({}))
}))

import {commonStyleLoaders} from '../common-style-loaders'
import {isUsingSass} from '../css-tools/sass'
import {maybeUsePostCss} from '../css-tools/postcss'

describe('commonStyleLoaders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty when no preprocessors or postcss are used', async () => {
    const res = await commonStyleLoaders('/p', {mode: 'development'})
    expect(res).toEqual([])
  })

  it('includes provided loader with sourceMap setting', async () => {
    const res = await commonStyleLoaders('/p', {
      mode: 'development',
      loader: 'sass-loader',
      loaderOptions: {foo: true}
    })
    expect(res[0].loader).toBe('sass-loader')
    expect(res[0].options.sourceMap).toBe(true)
    expect(res[0].options.foo).toBe(true)
  })

  it('adds postcss when maybeUsePostCss returns a loader', async () => {
    ;(maybeUsePostCss as any).mockResolvedValueOnce({
      loader: 'postcss-loader'
    })
    ;(isUsingSass as any).mockReturnValueOnce(true)
    const res = await commonStyleLoaders('/p', {mode: 'production'})
    expect(res.some((l: any) => l.loader === 'postcss-loader')).toBe(true)
  })
})
