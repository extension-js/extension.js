import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from '../../__spec__/helpers/build-project'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'
import type {BrowserType} from '../../types'

const makeTempFolder = trackTempFolders()

// The first statement of the polyfill, which only its own module carries.
const POLYFILL_MARK = 'This script should only be loaded in a browser extension'

function project(files: Record<string, string> = {}) {
  const root = fs.realpathSync(makeTempFolder('extjs-polyfill-alias-'))
  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'polyfill-alias',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'polyfill-alias',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
    'background.js':
      "import browser from 'webextension-polyfill'\n" +
      'browser.runtime.onInstalled.addListener(() => {})\n',
    ...files
  }

  for (const [name, text] of Object.entries(all)) {
    fs.writeFileSync(path.join(root, name), text)
  }

  return root
}

async function aliasFor(browser: BrowserType, polyfill: boolean) {
  const root = project()
  const config = webpackConfig(await getProjectStructure(root), {
    browser,
    polyfill,
    mode: 'production',
    output: {clean: false, path: path.join(root, 'dist', browser)}
  })

  return (config.resolve?.alias || {}) as Record<string, string>
}

describe('the webextension-polyfill alias', () => {
  it('is part of the config a project hook receives, on Chromium with the polyfill on', async () => {
    const alias = await aliasFor('chrome', true)

    expect(Object.keys(alias)).toEqual(['webextension-polyfill$'])
    expect(
      alias['webextension-polyfill$'].endsWith(
        path.join('webextension-polyfill', 'dist', 'browser-polyfill.js')
      )
    ).toBe(true)
  })

  it('is absent with the polyfill off and on a browser that needs none', async () => {
    expect(await aliasFor('chrome', false)).toEqual({})
    expect(await aliasFor('firefox', true)).toEqual({})
    expect(await aliasFor('safari', true)).toEqual({})
  })

  it('gives way to the alias a project sets for the same name', async () => {
    const root = project({
      'own-polyfill.js':
        'console.log("OWN COPY")\n' +
        'export default {runtime: {onInstalled: {addListener() {}}}}\n',
      'extension.config.js':
        "import * as path from 'node:path'\n" +
        'export default {\n' +
        '  config: (config) => {\n' +
        '    config.resolve.alias = {\n' +
        '      ...config.resolve.alias,\n' +
        "      'webextension-polyfill$': path.resolve('own-polyfill.js')\n" +
        '    }\n' +
        '    return config\n' +
        '  }\n' +
        '}\n'
    })
    const cwd = process.cwd()
    process.chdir(root)

    try {
      await buildProject(root, {polyfill: true})
    } finally {
      process.chdir(cwd)
    }

    const worker = fs.readFileSync(
      path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
      'utf8'
    )

    expect([
      worker.includes('OWN COPY'),
      worker.includes(POLYFILL_MARK)
    ]).toEqual([true, false])
  })

  it('still bundles the real polyfill for a project that sets no alias', async () => {
    const root = project()
    await buildProject(root, {polyfill: true})

    expect(
      fs
        .readFileSync(
          path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
          'utf8'
        )
        .includes(POLYFILL_MARK)
    ).toBe(true)
  })
})
