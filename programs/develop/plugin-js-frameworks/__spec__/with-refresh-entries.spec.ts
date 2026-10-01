import {describe, expect, it} from 'vitest'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../plugin-web-extension/feature-scripts/contracts'
import {withRefreshEntries} from '../index'

const refresh = [
  '/node_modules/@rspack/plugin-react-refresh/client/reactRefreshEntry.js'
]

describe('withRefreshEntries', () => {
  it('puts the runtime in front of page entries and leaves the rest alone', () => {
    const entry = {
      'action/index': {import: ['/p/popup.js']},
      'content_scripts/content-0': {
        import: ['/p/content.js'],
        layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER
      },
      'background/service_worker': {
        import: ['/p/sw.js'],
        chunkLoading: 'import-scripts'
      },
      'scripts/injected': {
        import: ['/p/injected.js'],
        layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER
      }
    }

    const next = withRefreshEntries(entry as never, refresh)

    expect(next['action/index']).toEqual({
      import: [...refresh, '/p/popup.js']
    })

    expect(next['content_scripts/content-0']).toBe(
      entry['content_scripts/content-0']
    )

    expect(next['scripts/injected']).toBe(entry['scripts/injected'])
    expect(next['background/service_worker']).toBe(
      entry['background/service_worker']
    )
  })

  it('is idempotent and tolerates string, array and missing entries', () => {
    const once = withRefreshEntries(
      {'options/index': {import: '/p/options.js'}} as never,
      refresh
    )
    const twice = withRefreshEntries(once, refresh)

    expect(twice['options/index']).toEqual({
      import: [...refresh, '/p/options.js']
    })

    expect(withRefreshEntries({a: '/p/a.js', b: ['/p/b.js']}, refresh)).toEqual(
      {a: '/p/a.js', b: ['/p/b.js']}
    )

    expect(withRefreshEntries(undefined, refresh)).toEqual({})
    expect(withRefreshEntries({x: {import: ['/p/x.js']}}, [])).toEqual({
      x: {import: ['/p/x.js']}
    })
  })
})
