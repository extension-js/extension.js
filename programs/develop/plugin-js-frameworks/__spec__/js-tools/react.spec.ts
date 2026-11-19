import {createRequire} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import * as resolver from '../../../lib/optional-deps-resolver'
import {maybeUseReact} from '../../js-tools/react'
import {fakePackage, makeProject} from '../project-fixture'

// The one fake in this file: every React tooling package resolves from
// Extension.js in this workspace, so only a stand-in can make one go missing.
vi.mock('../../../lib/optional-deps-resolver', async (importOriginal) => {
  const actual = await importOriginal<typeof resolver>()

  return {
    ...actual,
    resolveOptionalContractPackageWithoutInstall: vi.fn(
      actual.resolveOptionalContractPackageWithoutInstall
    )
  }
})

const fromDevelop = createRequire(
  path.join(__dirname, '..', '..', '..', 'x.js')
)
const {ReactRefreshRspackPlugin} = fromDevelop('@rspack/plugin-react-refresh')

function reactProject() {
  const root = makeProject({
    'package.json': {dependencies: {react: '19.0.0', 'react-dom': '19.0.0'}}
  })

  fakePackage(
    root,
    'react',
    {version: '19.0.0', main: 'index.js'},
    {'index.js': '', 'jsx-runtime.js': '', 'jsx-dev-runtime.js': ''}
  )

  fakePackage(
    root,
    'react-dom',
    {version: '19.0.0', main: 'index.js'},
    {'index.js': '', 'client.js': ''}
  )

  return root
}

function expectedAlias(root: string) {
  const modules = path.join(root, 'node_modules')

  return {
    react$: path.join(modules, 'react', 'index.js'),
    'react-dom$': path.join(modules, 'react-dom', 'index.js'),
    'react-dom/client': path.join(modules, 'react-dom', 'client.js'),
    'react/jsx-runtime': path.join(modules, 'react', 'jsx-runtime.js'),
    'react/jsx-dev-runtime': path.join(modules, 'react', 'jsx-dev-runtime.js')
  }
}

describe('maybeUseReact', () => {
  it('aliases React to the project copy and adds the refresh plugin with the given exclude', async () => {
    const root = reactProject()
    const refreshExclude = (resource: string) => resource.includes('content')
    const result = await maybeUseReact(root, {refreshExclude})

    expect(result?.alias).toEqual(expectedAlias(root))
    expect(result?.loaders).toBeUndefined()
    expect(result?.plugins).toHaveLength(1)

    const [plugin] = result?.plugins || []
    // v2 exports the class by name only (regression for #474).
    expect(plugin).toBeInstanceOf(ReactRefreshRspackPlugin)
    expect((plugin as unknown as {options: unknown}).options).toMatchObject({
      exclude: refreshExclude,
      // The plugin's own entry stays off: page entries get it from JsFrameworksPlugin.
      injectEntry: false,
      injectLoader: true
    })
  })

  it('leaves the refresh plugin out when refresh is disabled', async () => {
    const root = reactProject()
    const result = await maybeUseReact(root, {disableRefresh: true})

    expect(result).toEqual({
      plugins: [],
      loaders: undefined,
      alias: expectedAlias(root)
    })
  })

  it('aliases nothing it cannot resolve from the project', async () => {
    const root = makeProject({'package.json': {dependencies: {react: '19'}}})
    const result = await maybeUseReact(root, {disableRefresh: true})

    expect(result?.alias).toEqual({})
  })

  it('returns undefined when react is not a dependency', async () => {
    expect(
      await maybeUseReact(makeProject({'package.json': {}}))
    ).toBeUndefined()
  })

  it('throws when optional react tooling cannot be resolved', async () => {
    const missing = new Error('optional deps missing')
    vi.mocked(
      resolver.resolveOptionalContractPackageWithoutInstall
    ).mockImplementationOnce(() => {
      throw missing
    })

    await expect(maybeUseReact(reactProject())).rejects.toBe(missing)
  })
})
