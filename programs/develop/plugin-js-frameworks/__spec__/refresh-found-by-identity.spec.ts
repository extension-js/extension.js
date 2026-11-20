import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../plugin-web-extension/feature-scripts/contracts'
import {resolveReactRefreshEntry} from '../js-tools/react'
import {
  configure,
  fakePackage,
  MANIFEST,
  makeProject,
  rulesOf
} from './project-fixture'

// A refresh plugin of the project's own that keeps its entry in another
// folder and names another loader, as a later release of the real one could.
function projectWithItsOwnRefreshPlugin() {
  const root = makeProject({
    'package.json': {
      dependencies: {react: '19.0.0'},
      devDependencies: {
        '@rspack/plugin-react-refresh': '9.0.0',
        'react-refresh': '9.0.0'
      }
    },
    'manifest.json': MANIFEST
  })

  fakePackage(
    root,
    'react',
    {version: '19.0.0', main: 'index.js'},
    {
      'index.js': ''
    }
  )

  fakePackage(
    root,
    'react-refresh',
    {version: '9.0.0', main: 'index.js'},
    {
      'index.js': ''
    }
  )

  const plugin = fakePackage(
    root,
    '@rspack/plugin-react-refresh',
    {
      version: '9.0.0',
      exports: {
        '.': './main.cjs',
        './react-refresh-entry': './runtime/entry.js',
        './package.json': './package.json'
      }
    },
    {
      'runtime/entry.js': '',
      'main.cjs':
        'class ReactRefreshRspackPlugin {\n' +
        '  apply(compiler) {\n' +
        '    compiler.options.module.rules.unshift({\n' +
        "      test: /\\.jsx?$/,\n      use: 'builtin:renamed-refresh-loader'\n" +
        '    })\n  }\n}\n' +
        'module.exports = {ReactRefreshRspackPlugin}\n'
    }
  )

  return {root, plugin}
}

describe('the React refresh entry and rule, found without their names', () => {
  it('takes the entry from the export the plugin package declares', () => {
    const {root, plugin} = projectWithItsOwnRefreshPlugin()

    expect(resolveReactRefreshEntry(root)).toBe(
      path.join(plugin, 'runtime', 'entry.js')
    )
  })

  it('keeps the rule the plugin adds out of content scripts, whatever loader it names', async () => {
    const {root} = projectWithItsOwnRefreshPlugin()
    const added = rulesOf(await configure(root)).filter(
      (rule) => rule.use === 'builtin:renamed-refresh-loader'
    )

    expect(added).toHaveLength(1)
    expect(added[0].issuerLayer).toEqual({
      not: EXTENSIONJS_CONTENT_SCRIPT_LAYER
    })
  })

  it('gives no layer condition to a rule the project wrote', async () => {
    const {root} = projectWithItsOwnRefreshPlugin()
    const own = {test: /\.custom$/, use: 'builtin:react-refresh-loader'}
    const compiler = await configure(root, {rules: [own]})

    expect(
      rulesOf(compiler).find((rule) => rule.test === own.test)?.issuerLayer
    ).toBeUndefined()
  })
})
