import * as path from 'node:path'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../plugin-web-extension/feature-scripts/contracts'

const projectFilesMocks = vi.hoisted(() => ({
  manifest: {} as Record<string, any>
}))

vi.mock('../js-tools/react', () => ({
  isUsingReact: vi.fn(() => true),
  maybeUseReact: vi.fn(async () => ({alias: {}, loaders: [], plugins: []}))
}))
vi.mock('../js-tools/preact', () => ({
  isUsingPreact: vi.fn(() => false),
  maybeUsePreact: vi.fn(async () => undefined)
}))
vi.mock('../js-tools/vue', () => ({
  isUsingVue: vi.fn(() => false),
  maybeUseVue: vi.fn(async () => undefined)
}))
vi.mock('../js-tools/solid', () => ({
  isUsingSolid: vi.fn(() => false),
  maybeUseSolid: vi.fn(async () => undefined)
}))
vi.mock('../js-tools/svelte', () => ({
  maybeUseSvelte: vi.fn(async () => undefined)
}))
vi.mock('../js-tools/typescript', () => ({
  isUsingTypeScript: vi.fn(() => false),
  ensureTypeScriptConfig: vi.fn(),
  getUserTypeScriptConfigFile: vi.fn(() => undefined)
}))
vi.mock('../../lib/transpile-packages', () => ({
  resolveTranspilePackageDirs: vi.fn(() => []),
  isSubPath: vi.fn(
    (resourcePath: string, directoryPath: string) =>
      resourcePath === directoryPath ||
      resourcePath.startsWith(`${directoryPath}/`)
  )
}))
vi.mock('../../plugin-special-folders/get-data', () => ({
  getSpecialFoldersDataForCompiler: vi.fn(() => ({pages: {}, scripts: {}}))
}))
vi.mock('../../plugin-web-extension/shared/manifest-fields', () => ({
  getResolvedManifestFieldsData: vi.fn(() => ({html: {}}))
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    readFileSync: vi.fn((filePath: any) => {
      if (String(filePath).endsWith('manifest.json')) {
        return JSON.stringify(projectFilesMocks.manifest)
      }
      return (actual.readFileSync as any)(filePath)
    })
  }
})

import {JsFrameworksPlugin} from '../index'

function createCompiler() {
  return {
    options: {
      mode: 'development',
      context: '/project',
      plugins: [] as any[],
      resolve: {alias: {}, extensions: [] as string[]},
      module: {rules: [] as any[]}
    },
    hooks: {
      beforeRun: {tapPromise: vi.fn()},
      watchRun: {tapPromise: vi.fn()}
    }
  } as any
}

async function contentScriptLayerInclude(
  manifest: Record<string, unknown>,
  browser: string
) {
  projectFilesMocks.manifest = manifest
  const compiler = createCompiler()
  await new JsFrameworksPlugin({
    manifestPath: path.join('/project', 'manifest.json'),
    browser: browser as any,
    mode: 'development'
  }).apply(compiler)

  const layerRule = compiler.options.module.rules.find(
    (rule: any) =>
      rule?.layer === EXTENSIONJS_CONTENT_SCRIPT_LAYER &&
      typeof rule?.include === 'function'
  )
  return layerRule.include as (resourcePath: string) => boolean
}

describe('JsFrameworksPlugin content-script layer, browser-prefixed keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('claims a content script declared under firefox:content_scripts', async () => {
    const include = await contentScriptLayerInclude(
      {'firefox:content_scripts': [{js: ['content/script.js']}]},
      'firefox'
    )
    expect(include('/project/content/script.js')).toBe(true)
  })

  it('claims a chrome:-prefixed content script on any chromium target', async () => {
    const include = await contentScriptLayerInclude(
      {'chrome:content_scripts': [{js: ['content/script.js']}]},
      'edge'
    )
    expect(include('/project/content/script.js')).toBe(true)
  })

  it('leaves another browser prefix out of this build', async () => {
    const include = await contentScriptLayerInclude(
      {'firefox:content_scripts': [{js: ['content/script.js']}]},
      'chrome'
    )
    expect(include('/project/content/script.js')).toBe(false)
  })

  it('still claims a plain content script', async () => {
    const include = await contentScriptLayerInclude(
      {content_scripts: [{js: ['content/script.js']}]},
      'chrome'
    )
    expect(include('/project/content/script.js')).toBe(true)
  })
})
