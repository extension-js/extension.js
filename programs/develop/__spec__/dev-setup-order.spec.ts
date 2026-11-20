import * as fs from 'node:fs'
import * as path from 'node:path'
import {type RspackPluginInstance, rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {CssPlugin} from '../plugin-css'
import {JsFrameworksPlugin} from '../plugin-js-frameworks'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()

type Rule = {test?: unknown}

const matches = (rules: unknown, file: string) =>
  (rules as Rule[]).some(
    (rule) => rule?.test instanceof RegExp && rule.test.test(file)
  )

// Each write of the rule list, by which half of the table it holds.
async function writesOf(
  mode: 'development' | 'production',
  dependencies: Record<string, string>
) {
  const root = fs.realpathSync(makeTempFolder('extjs-setup-order-'))
  const manifestPath = path.join(root, 'manifest.json')

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'order', dependencies})
  )

  fs.writeFileSync(
    manifestPath,
    JSON.stringify({manifest_version: 3, name: 'order', version: '1.0.0'})
  )

  const compiler = rspack({
    mode,
    context: root,
    entry: {},
    output: {path: path.join(root, 'dist')},
    module: {rules: []}
  })
  const writes: string[] = []
  let rules = compiler.options.module.rules

  Object.defineProperty(compiler.options.module, 'rules', {
    configurable: true,
    get: () => rules,
    set: (next) => {
      rules = next
      writes.push(
        [
          matches(next, '/p/a.css') ? 'css' : '',
          JSON.stringify(next).includes('builtin:swc-loader') ? 'scripts' : ''
        ]
          .filter(Boolean)
          .join('+')
      )
    }
  })

  // In the order the config lists them, and not awaited, as rspack does.
  const pending = [
    new CssPlugin({manifestPath, browser: 'chrome'}),
    new JsFrameworksPlugin({manifestPath, browser: 'chrome', mode})
  ].map((plugin) => (plugin as unknown as RspackPluginInstance).apply(compiler))

  if (mode === 'production') {
    await compiler.hooks.beforeRun.promise(compiler)
  } else {
    await compiler.hooks.watchRun.promise(compiler)
  }

  await Promise.all(pending)
  await new Promise((done) => compiler.close(done))

  return writes
}

describe('the order the stylesheet and script setups write their rules', () => {
  it('is the same in a dev run as in a build', async () => {
    const dependencies = {}
    const build = await writesOf('production', dependencies)
    const dev = await writesOf('development', dependencies)

    expect(build).toEqual(['css', 'css+scripts'])
    expect(dev).toEqual(build)
  })
})
