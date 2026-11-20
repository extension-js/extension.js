import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {PerfBudgetsPlugin, resetPerfBudgetNotices} from '../index'

// A dev session is told once that its dev-only budgets do nothing, and it
// reads the config under the env files of the browser it compiles for.
const KEY = 'EXTENSION_PUBLIC_DEV_BUDGET'
const roots: string[] = []
let saved: string | undefined

beforeEach(() => {
  saved = process.env[KEY]
  delete process.env[KEY]
  resetPerfBudgetNotices()
})

afterEach(() => {
  vi.restoreAllMocks()

  if (saved === undefined) delete process.env[KEY]
  else process.env[KEY] = saved

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

function project(): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-budgets-'))
  )
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'dev-budgets', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'extension.config.js'),
    `module.exports = {commands: {dev: {perfBudgets: process.env.${KEY} === '1' ? {total: 1} : undefined}}}\n`
  )

  fs.writeFileSync(path.join(root, '.env.firefox'), `${KEY}=1\n`)

  return root
}

// The watch run of a development compiler with the plugin applied.
async function watchRunOf(root: string, browser?: string) {
  const taps: Array<() => Promise<void>> = []
  const compiler = {
    options: {mode: 'development', context: root},
    hooks: {
      watchRun: {
        tapPromise: (_name: string, run: () => Promise<void>) => taps.push(run)
      }
    }
  } as unknown as Compiler

  new PerfBudgetsPlugin({browser}).apply(compiler)

  for (const run of taps) await run()
}

describe('the notice that dev budgets do nothing', () => {
  it('reads the config under the env files of the session browser', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = project()

    await watchRunOf(root, 'firefox')

    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toContain('extension.config.js')
  })

  it('says nothing for a browser whose env files set no dev budget', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await watchRunOf(project(), 'chrome')

    expect(error).not.toHaveBeenCalled()
  })
})
