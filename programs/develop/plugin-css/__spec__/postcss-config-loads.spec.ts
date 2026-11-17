import * as fs from 'node:fs'
import * as path from 'node:path'
import type {RuleSetRule} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {postCssReaderForOneCompiler} from '../css-tools/postcss'
import {configureCss, cssProjects, type Mode} from './helpers/css-project'

const makeProject = cssProjects()

// The config writes one line when Node evaluates the file and one when the
// build calls the function it exports.
function countingConfig(log: string) {
  return [
    "const fs = require('fs')",
    `fs.appendFileSync(${JSON.stringify(log)}, 'evaluated\\n')`,
    'module.exports = () => {',
    `  fs.appendFileSync(${JSON.stringify(log)}, 'called\\n')`,
    '  return {plugins: []}',
    '}',
    ''
  ].join('\n')
}

function counts(log: string) {
  const lines = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
    : []

  return {
    evaluated: lines.filter((line) => line === 'evaluated').length,
    called: lines.filter((line) => line === 'called').length
  }
}

// One compiler builds 24 style rules and reads the config for the first.
describe('how often one compiler reads the PostCSS config', () => {
  it.each([
    ['development', 'postcss.config.cjs', {evaluated: 1, called: 1}],
    ['production', 'postcss.config.cjs', {evaluated: 1, called: 1}],
    ['development', 'postcss.config.js', {evaluated: 1, called: 1}],
    ['production', 'postcss.config.js', {evaluated: 1, called: 1}]
  ] as Array<
    [Mode, string, ReturnType<typeof counts>]
  >)('%s build, %s', async (mode, configFile, expected) => {
    const root = makeProject({}, 'extjs-postcss-loads-')
    const log = path.join(root, 'loads.log')
    fs.writeFileSync(path.join(root, configFile), countingConfig(log))

    await configureCss(root, mode)

    expect(counts(log)).toEqual(expected)
  })

  it('reads once per mode, and hands each mode its own rule', async () => {
    const root = makeProject({}, 'extjs-postcss-modes-')
    const log = path.join(root, 'loads.log')
    fs.writeFileSync(path.join(root, 'postcss.config.cjs'), countingConfig(log))
    const read = postCssReaderForOneCompiler()

    const dev = await read(root, {mode: 'development'})
    const again = await read(root, {mode: 'development'})
    const prod = await read(root, {mode: 'production'})

    expect(again).toBe(dev)
    expect(dev.options.sourceMap).toBe(true)
    expect(prod.options.sourceMap).toBe(false)
    expect(counts(log)).toEqual({evaluated: 2, called: 2})
  })
})

function postCssPluginNames(rules: RuleSetRule[]): string[] {
  const names = new Set<string>()

  for (const rule of rules) {
    for (const use of (Array.isArray(rule.use) ? rule.use : []) as Array<{
      loader?: string
      options?: {postcssOptions?: {plugins?: Array<{postcssPlugin?: string}>}}
    }>) {
      if (!String(use.loader).includes('postcss-loader')) continue

      for (const plugin of use.options?.postcssOptions?.plugins || []) {
        names.add(String(plugin.postcssPlugin))
      }
    }
  }

  return [...names]
}

// Nothing restarts a dev session for a PostCSS config edit. The next
// compiler, which a restart for any other reason builds, reads it again.
describe('a PostCSS config edit between two compilers', () => {
  it.each([
    ['development', 'postcss.config.cjs', ['second']],
    ['production', 'postcss.config.cjs', ['second']],
    // Node keeps the module it imported first, so the edit is not seen.
    ['development', 'postcss.config.js', ['first']]
  ] as Array<
    [Mode, string, string[]]
  >)('%s, %s', async (mode, configFile, after) => {
    const root = makeProject({}, 'extjs-postcss-edit-')
    const config = path.join(root, configFile)
    const write = (name: string) =>
      fs.writeFileSync(
        config,
        `module.exports = {plugins: [{postcssPlugin: '${name}'}]}\n`
      )

    write('first')
    const before = await configureCss(root, mode)
    write('second')
    const next = await configureCss(root, mode)

    expect(postCssPluginNames(before)).toEqual(['first'])
    // Pins today's behavior. Ledger 1390 D3.
    expect(postCssPluginNames(next)).toEqual(after)
  })
})
