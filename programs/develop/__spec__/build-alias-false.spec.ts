import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(opts: {alias?: Record<string, false>; background: string}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-alias-false-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'alias-false', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'alias-false',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), opts.background)

  if (opts.alias) {
    fs.writeFileSync(path.join(root, 'alias.json'), JSON.stringify(opts.alias))
    fs.writeFileSync(
      path.join(root, 'extension.config.js'),
      "const alias = require('./alias.json')\nmodule.exports = {config: (config) => ({...config, resolve: {...config.resolve, alias: {...(config.resolve && config.resolve.alias), ...alias}}})}\n"
    )
  }

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

const bundle = (root: string) =>
  fs.readFileSync(
    path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
    'utf-8'
  )

describe('a bare require() the project aliases to false', () => {
  it('becomes the empty module, so the browser bundle carries no require() call', async () => {
    const root = project({
      background:
        "const dead = require('regenerator-runtime/runtime')\nconsole.log(dead)\n",
      alias: {'regenerator-runtime/runtime$': false}
    })
    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(bundle(root)).not.toMatch(/require\(["']regenerator-runtime/)
    expect(
      (summary.warnings || []).filter((text: string) =>
        text.includes('regenerator-runtime')
      )
    ).toEqual([])
  })

  it('still warns, naming request and issuer, when nothing resolves the require', async () => {
    const root = project({
      background:
        "const dead = require('no-such-package-anywhere')\nconsole.log(dead)\n"
    })
    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(bundle(root)).toMatch(/require\(["']no-such-package-anywhere["']\)/)
    const warning = (summary.warnings || []).find((text: string) =>
      text.includes("require('no-such-package-anywhere')")
    )
    expect(warning).toBeDefined()
    expect(warning).toContain('background.js')
  })
})
