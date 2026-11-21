import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'
import {writeExtensionProject} from './helpers/extension-project'

const tempFolder = trackTempFolders()

function project(opts: {alias?: Record<string, false>; background: string}) {
  const root = tempFolder('extjs-alias-false-')
  writeExtensionProject(root, {
    name: 'alias-false',
    manifest: {background: {service_worker: 'background.js'}}
  })

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
  return buildProject(root, {
    mode: 'production'
  })
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
