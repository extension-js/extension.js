import {describe, it, expect, vi, beforeEach} from 'vitest'

describe('loadPluginsFromUserConfig helper', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('normalizes array, tuple, map and postcss property forms', async () => {
    vi.doMock('module', () => ({
      createRequire: (_: string) => {
        const req = (id: string) => {
          if (id.endsWith('postcss.config.js')) {
            return {
              plugins: [
                'plugin-a',
                ['plugin-b', {b: true}],
                {postcss: () => 'plugin-c-fn'},
                {'plugin-d': true, 'plugin-e': {e: 1}, 'plugin-f': false}
              ]
            }
          }
          if (id === 'plugin-a') return () => 'plugin-a-fn'
          if (id === 'plugin-b') return () => 'plugin-b-fn'
          if (id === 'plugin-d') return () => 'plugin-d-fn'
          if (id === 'plugin-e') return () => 'plugin-e-fn'
          throw new Error('unexpected require: ' + id)
        }
        return req as any
      }
    }))

    const {loadPluginsFromUserConfig} = await import(
      '../../css-tools/postcss/load-plugins-from-user-config'
    )
    const res = await loadPluginsFromUserConfig(
      '/p',
      '/p/postcss.config.js',
      'development'
    )
    expect(res && res.length).toBe(5)
  })

  it('returns empty list when plugins missing', async () => {
    vi.doMock('module', () => ({
      createRequire: (_: string) => {
        const req = (id: string) => {
          if (id.endsWith('postcss.config.js')) {
            return {}
          }
          throw new Error('unexpected require: ' + id)
        }
        return req as any
      }
    }))

    const {loadPluginsFromUserConfig} = await import(
      '../../css-tools/postcss/load-plugins-from-user-config'
    )
    const res = await loadPluginsFromUserConfig(
      '/p',
      '/p/postcss.config.js',
      'production'
    )
    expect(Array.isArray(res)).toBe(true)
    expect(res?.length).toBe(0)
  })
})
