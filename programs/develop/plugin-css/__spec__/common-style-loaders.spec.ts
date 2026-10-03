import type {RuleSetRule} from '@rspack/core'
import {beforeEach, describe, expect, it, vi} from 'vitest'

// The product returns rspack's RuleSetUse union. These specs only ever get
// the array form back, so read it as one.
type LoaderItem = {loader?: string; options?: Record<string, unknown>}
const items = (use: RuleSetRule['use']) => use as LoaderItem[]

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
  isUsingPostCss: vi.fn(() => false),
  maybeUsePostCss: vi.fn(async () => ({}))
}))

import {commonStyleLoaders} from '../common-style-loaders'
import {maybeUsePostCss} from '../css-tools/postcss'
import {isUsingSass} from '../css-tools/sass'

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
    expect(items(res)[0].loader).toBe('sass-loader')
    expect(items(res)[0].options?.sourceMap).toBe(true)
    expect(items(res)[0].options?.foo).toBe(true)
  })

  it('adds postcss when maybeUsePostCss returns a loader', async () => {
    ;(maybeUsePostCss as any).mockResolvedValueOnce({
      loader: 'postcss-loader'
    })
    ;(isUsingSass as any).mockReturnValueOnce(true)
    const res = await commonStyleLoaders('/p', {mode: 'production'})
    expect(items(res).some((l) => l.loader === 'postcss-loader')).toBe(true)
  })
})
