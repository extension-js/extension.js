import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-define-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'define', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'define',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

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
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

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
