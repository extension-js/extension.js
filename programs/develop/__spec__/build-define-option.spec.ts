import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'
import {writeExtensionProject} from './helpers/extension-project'

const tempFolder = trackTempFolders()

function project() {
  const root = tempFolder('extjs-define-')

  writeExtensionProject(root, {
    name: 'define',
    manifest: {background: {service_worker: 'background.js'}}
  })

  fs.writeFileSync(
    path.join(root, 'background.js'),
    'console.log("version", VERSION, "chrome", __IS_CHROME__, "flags", FLAGS.beta)\n'
  )

  fs.writeFileSync(
    path.join(root, 'extension.config.js'),
    [
      'module.exports = {',
      "  define: {VERSION: '9.9.9-DEFINE_MARK', __IS_CHROME__: false, FLAGS: {beta: true}},",
      '  browser: {',
      '    chrome: {define: {__IS_CHROME__: true}}',
      '  }',
      '}',
      ''
    ].join('\n')
  )

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const summary = await buildProject(root, {browser, mode: 'production'})
  expect(summary.errors_count).toBe(0)

  return fs.readFileSync(
    path.join(root, 'dist', browser, 'background', 'service_worker.js'),
    'utf8'
  )
}

describe('define in extension.config.js', () => {
  it('inlines the constants, with the browser layer on top', async () => {
    const root = project()

    const chrome = await build(root, 'chrome')
    expect(chrome).toContain('9.9.9-DEFINE_MARK')
    expect(chrome).toContain('"chrome",!0')
    expect(chrome).not.toContain('VERSION')

    const firefox = await build(root, 'firefox')
    expect(firefox).toContain('9.9.9-DEFINE_MARK')
    expect(firefox).toContain('"chrome",!1')
  })
})
