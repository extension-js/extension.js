import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {maybeUsePreact} from '../../js-tools/preact'
import {fakePackage, makeProject} from '../project-fixture'

// Preact's sub-paths exist only through its exports map, as in the real package.
function preactProject(dependencies: Record<string, string>) {
  const root = makeProject({'package.json': {dependencies}})
  const dir = fakePackage(
    root,
    'preact',
    {
      version: '10.0.0',
      exports: {
        '.': './dist/preact.js',
        './compat': './compat/dist/compat.js',
        './test-utils': './test-utils/dist/testUtils.js',
        './jsx-runtime': './jsx-runtime/dist/jsxRuntime.js',
        './jsx-dev-runtime': './jsx-runtime/dist/jsxRuntime.js',
        './package.json': './package.json'
      }
    },
    {
      'dist/preact.js': '',
      'compat/dist/compat.js': '',
      'test-utils/dist/testUtils.js': '',
      'jsx-runtime/dist/jsxRuntime.js': ''
    }
  )

  return {root, dir}
}

describe('maybeUsePreact', () => {
  it('aliases the JSX runtimes first, then preact, then the React names to compat', async () => {
    const {root, dir} = preactProject({preact: '10'})
    const result = await maybeUsePreact(root)
    const jsxRuntime = path.join(dir, 'jsx-runtime', 'dist', 'jsxRuntime.js')
    const compat = path.join(dir, 'compat', 'dist', 'compat.js')

    expect(result?.plugins).toEqual([])
    expect(result?.loaders).toBeUndefined()
    // rspack takes the first alias key that matches, in insertion order.
    expect(Object.entries(result?.alias || {})).toEqual([
      ['preact/jsx-runtime', jsxRuntime],
      ['preact/jsx-dev-runtime', jsxRuntime],
      ['preact', dir],
      ['react', compat],
      ['react-dom', compat],
      [
        'react-dom/test-utils',
        path.join(dir, 'test-utils', 'dist', 'testUtils.js')
      ],
      ['react/jsx-runtime', jsxRuntime],
      ['react/jsx-dev-runtime', jsxRuntime]
    ])
  })

  it('keeps only its own keys where React is declared too', async () => {
    const {root, dir} = preactProject({preact: '10', react: '19'})
    const result = await maybeUsePreact(root)

    expect(Object.keys(result?.alias || {})).toEqual([
      'preact/jsx-runtime',
      'preact/jsx-dev-runtime',
      'preact'
    ])

    expect(result?.alias?.preact).toBe(dir)
  })

  it('never loads the Preact refresh plugin, since fast refresh is off', async () => {
    const {root} = preactProject({preact: '10'})
    await maybeUsePreact(root)

    expect(
      Object.keys(require.cache).filter((id) =>
        id.includes(`${path.sep}plugin-preact-refresh${path.sep}`)
      )
    ).toEqual([])
  })

  it('returns undefined when preact is not a dependency', async () => {
    expect(
      await maybeUsePreact(makeProject({'package.json': {}}))
    ).toBeUndefined()
  })
})
