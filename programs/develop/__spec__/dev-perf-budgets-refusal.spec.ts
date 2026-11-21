import * as fs from 'node:fs'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'

// Budgets only run on a production build, yet a value build refuses is a
// config mistake dev must name too, before any server or port is opened.
const devServer = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('../dev-server', () => ({devServer}))

const tempFolder = trackTempFolders()

afterEach(() => {
  devServer.mockClear()
  vi.restoreAllMocks()
})

function project(perfBudgets: string) {
  const root = fs.realpathSync(tempFolder('extjs-dev-budgets-refusal-'))
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'dev-budgets-refusal',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'dev-budgets-refusal',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
    'background.js': 'console.log(1)\n',
    'extension.config.js': `module.exports = {perfBudgets: ${perfBudgets}}\n`
  }

  for (const [file, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, file), text)
  }

  return root
}

async function dev(root: string) {
  const {extensionDev} = await import('../command-dev')

  return extensionDev(root, {
    browser: 'chromium',
    install: false,
    noBrowser: true,
    exitOnError: false
  })
}

describe('dev with a perfBudgets value build refuses', () => {
  it.each([
    [
      "{onExceed: 'fail'}",
      "perfBudgets.onExceed in extension.config.js must be 'warn' or 'error', found the string \"fail\"."
    ],
    [
      "{'content-script': 'big'}",
      'perfBudgets.content-script in extension.config.js must be a finite number of bytes above 0'
    ]
  ])('refuses %s with E_CONFIG_LOAD and starts no server', async (budgets, words) => {
    const root = project(budgets)
    const failure = (await dev(root).catch((error) => error)) as Error & {
      code?: string
    }

    expect(failure).toBeInstanceOf(Error)
    expect(failure.code).toBe('E_CONFIG_LOAD')
    expect(stripVTControlCharacters(failure.message)).toContain(words)
    expect(devServer).not.toHaveBeenCalled()
  })

  it('starts as before when the budgets are valid', async () => {
    await dev(project("{'content-script': 1024, onExceed: 'error'}"))

    expect(devServer).toHaveBeenCalledTimes(1)
  })
})
