import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

let mockRoot = ''
let projectRoot = ''
const installOptionalDependenciesBatch = vi.fn(async () => undefined)

vi.mock('../check-build-dependencies', () => ({
  findExtensionDevelopRoot: () => mockRoot
}))
vi.mock('../preflight-cache', () => ({
  hasPreflightMarker: () => false,
  writePreflightMarker: vi.fn()
}))
vi.mock('../plugin-js-frameworks/frameworks-lib/integrations', () => ({
  installOptionalDependenciesBatch: (...args: any[]) =>
    installOptionalDependenciesBatch(...args)
}))
vi.mock('../plugin-js-frameworks/js-tools/react', () => ({
  isUsingReact: () => true
}))
vi.mock('../plugin-js-frameworks/js-tools/preact', () => ({
  isUsingPreact: () => false
}))
vi.mock('../plugin-js-frameworks/js-tools/vue', () => ({
  isUsingVue: () => false
}))
vi.mock('../plugin-js-frameworks/js-tools/svelte', () => ({
  isUsingSvelte: () => false
}))
vi.mock('../plugin-js-frameworks/js-tools/typescript', () => ({
  isUsingTypeScript: () => false
}))
vi.mock('../plugin-css/css-tools/sass', () => ({
  isUsingSass: () => false
}))
vi.mock('../plugin-css/css-tools/less', () => ({
  isUsingLess: () => false
}))
vi.mock('../plugin-css/css-tools/postcss', () => ({
  isUsingPostCss: () => false
}))

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, content)
}

describe('preflight-optional-deps', () => {
  beforeEach(() => {
    installOptionalDependenciesBatch.mockClear()
    mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-preflight-'))
    projectRoot = path.join(mockRoot, 'project')
    fs.mkdirSync(projectRoot, {recursive: true})
    writeFile(path.join(projectRoot, 'manifest.json'), JSON.stringify({}))
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({name: 'sample-extension', version: '0.0.0'})
    )

    writeFile(
      path.join(mockRoot, 'node_modules', 'react-refresh', 'index.js'),
      'module.exports = {};'
    )
    writeFile(
      path.join(
        mockRoot,
        'node_modules',
        '@rspack',
        'plugin-react-refresh',
        'index.js'
      ),
      'module.exports = {};'
    )
  })

  afterEach(() => {
    if (mockRoot && fs.existsSync(mockRoot)) {
      fs.rmSync(mockRoot, {recursive: true, force: true})
    }
  })

  it('does not install optional deps when they resolve from extension-develop root', async () => {
    const {preflightOptionalDependencies} =
      await import('../preflight-optional-deps')

    await preflightOptionalDependencies(
      {
        manifestPath: path.join(projectRoot, 'manifest.json'),
        packageJsonPath: path.join(projectRoot, 'package.json')
      },
      'development',
      {exitOnInstall: false, showRunAgainMessage: false}
    )

    expect(installOptionalDependenciesBatch).not.toHaveBeenCalled()
  })
})
