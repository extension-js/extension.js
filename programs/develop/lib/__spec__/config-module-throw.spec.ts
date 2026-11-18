import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {setTimeout as wait} from 'node:timers/promises'
import {pathToFileURL} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {loadCommandConfig, loadProjectConfigDefaults} from '../config-loader'

const makeTempFolder = trackTempFolders()

function makeProject(files: Record<string, string>, type?: 'module') {
  const dir = fs.realpathSync(makeTempFolder('tmp-extjs-module-throw-'))

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({name: 'demo', ...(type ? {type} : {})})
  )

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }

  return dir
}

describe('an ES module config that throws', () => {
  const stray: unknown[] = []

  const onStray = (reason: unknown) => {
    stray.push(reason)
  }

  beforeEach(() => {
    stray.length = 0
    process.on('unhandledRejection', onStray)
  })

  afterEach(() => {
    process.off('unhandledRejection', onStray)
  })

  // Node reports a rejection nobody observed after the microtask queue
  // drains, so a turn of the timer queue is enough to see one.
  async function strayRejections() {
    await wait(50)

    return stray.map((reason) => String((reason as Error)?.message || reason))
  }

  it.each([
    ['extension.config.js', 'module'],
    ['extension.config.mjs', undefined]
  ] as const)('surfaces one coded error from %s and leaves no rejection behind', async (name, type) => {
    const dir = makeProject(
      {[name]: "throw new Error('config boom')\nexport default {}\n"},
      type
    )

    for (const load of [
      () => loadCommandConfig(dir, 'dev'),
      () => loadProjectConfigDefaults(dir)
    ]) {
      await expect(load()).rejects.toMatchObject({
        code: 'E_CONFIG_LOAD',
        cause: {message: 'config boom'}
      })
    }

    expect(await strayRejections()).toEqual([])
  })

  it('reports a module it imports that throws the same way', async () => {
    const dir = makeProject(
      {
        'broken-dep.js': "throw new Error('dep boom')\n",
        'extension.config.js': "import './broken-dep.js'\nexport default {}\n"
      },
      'module'
    )

    await expect(loadCommandConfig(dir, 'build')).rejects.toMatchObject({
      code: 'E_CONFIG_LOAD',
      cause: {message: 'dep boom'}
    })

    expect(await strayRejections()).toEqual([])
  })
})

// Vitest runs a config it imports through its own module runner, so the cases
// above reach Node's loader only on the retry. The built package in a child
// process is the path a real command takes.
describe('an ES module project config, under plain Node', () => {
  const builtModule = path.resolve(__dirname, '..', '..', 'dist', 'module.mjs')

  // The child listens for nothing, so a rejection left behind ends it the way
  // it ends a command: a crash frame, status 1 and no result line.
  function loadDevCommandConfig(dir: string, afterLoad = '') {
    const script = `
import {setTimeout as wait} from 'node:timers/promises'
import {loadCommandConfig} from ${JSON.stringify(pathToFileURL(builtModule).href)}

const outcome = await loadCommandConfig(${JSON.stringify(dir)}, 'dev').then(
  (config) => ({config}),
  (error) => ({code: error.code, cause: String(error.cause?.message)})
)
${afterLoad}
await wait(50)
process.stdout.write('RESULT:' + JSON.stringify(outcome))
`
    // A script file, because --eval exposes node:module as a global named
    // module, which a CommonJS config would then assign its exports onto.
    const scriptPath = path.join(makeTempFolder('tmp-extjs-runner-'), 'run.mjs')
    fs.writeFileSync(scriptPath, script)

    const run = spawnSync(process.execPath, [scriptPath], {encoding: 'utf-8'})

    return {
      status: run.status,
      stderr: run.stderr,
      result: JSON.parse(run.stdout.split('RESULT:')[1] || 'null') as {
        config?: {port?: number}
        code?: string
        cause?: string
      } | null
    }
  }

  it('has the built package to run', () => {
    expect(fs.existsSync(builtModule)).toBe(true)
  })

  it('surfaces one coded error and leaves no rejection behind', () => {
    const dir = makeProject(
      {
        'extension.config.js':
          "throw new Error('config boom')\nexport default {}\n"
      },
      'module'
    )

    expect(loadDevCommandConfig(dir)).toMatchObject({
      status: 0,
      result: {code: 'E_CONFIG_LOAD', cause: 'config boom'}
    })
  })

  it('does the same when a CommonJS config requires an ES module that throws', () => {
    const dir = makeProject({
      'broken-dep.mjs': "throw new Error('dep boom')\n",
      'extension.config.js':
        "require('./broken-dep.mjs')\nmodule.exports = {}\n"
    })

    expect(loadDevCommandConfig(dir)).toMatchObject({
      status: 0,
      result: {code: 'E_CONFIG_LOAD', cause: 'dep boom'}
    })
  })

  it('lets an unrelated rejection in the same turn end the process', () => {
    const dir = makeProject({
      'broken-dep.mjs': "throw new Error('dep boom')\n",
      'extension.config.js':
        "require('./broken-dep.mjs')\nmodule.exports = {}\n"
    })

    const run = loadDevCommandConfig(
      dir,
      "Promise.reject(new Error('unrelated failure'))"
    )

    expect(run.status).toBe(1)
    expect(run.result).toBeNull()
    expect(run.stderr).toContain('unrelated failure')
    expect(run.stderr).not.toContain('dep boom')
  })

  it.each([
    [
      'assigns module.exports',
      'module.exports = {commands: {dev: {port: 4321}}}\n'
    ],
    [
      'calls require first',
      "const path = require('node:path')\nmodule.exports = {commands: {dev: {port: path.sep.length + 4320}}}\n"
    ]
  ])('loads a CommonJS config that %s', (_label, source) => {
    const dir = makeProject({'extension.config.js': source}, 'module')

    expect(loadDevCommandConfig(dir)).toMatchObject({
      status: 0,
      result: {config: {port: 4321}}
    })
  })
})
