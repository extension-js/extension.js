import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
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

// A .cjs config is run from its text on every read. A .js config is
// imported, and Node evaluates an imported file once per process.
describe('how often one compiler reads the PostCSS config', () => {
  it.each([
    ['development', 'postcss.config.cjs', {evaluated: 24, called: 24}],
    ['production', 'postcss.config.cjs', {evaluated: 24, called: 24}],
    ['development', 'postcss.config.js', {evaluated: 1, called: 24}],
    ['production', 'postcss.config.js', {evaluated: 1, called: 24}]
  ] as Array<
    [Mode, string, ReturnType<typeof counts>]
  >)('%s build, %s', async (mode, configFile, expected) => {
    const root = makeProject({}, 'extjs-postcss-loads-')
    const log = path.join(root, 'loads.log')
    fs.writeFileSync(path.join(root, configFile), countingConfig(log))

    await configureCss(root, mode)

    // Pins today's behavior. Ledger 1390 D3.
    expect(counts(log)).toEqual(expected)
  })
})
