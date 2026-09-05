import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// One specificity ladder for every key that can live in more than one
// place: a top-level value is the weakest layer, browser.<vendor> beats it,
// commands.<cmd> beats both, a CLI flag beats everything.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(config: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-layers-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'layers', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'layers',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )
  fs.writeFileSync(
    path.join(root, 'background.js'),
    'console.log("bg");\n'.repeat(50)
  )
  fs.writeFileSync(path.join(root, 'extension.config.js'), config)
  return root
}

async function build(root: string, extra: Record<string, unknown> = {}) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalWarn = console.warn
  const originalLog = console.log
  const originalError = console.error
  console.warn = (...args: unknown[]) => lines.push(args.join(' '))
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  let summary: {errors_count: number; warnings_count: number}
  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false,
      ...extra
    } as any)
  } finally {
    console.warn = originalWarn
    console.log = originalLog
    console.error = originalError
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  expect(summary.errors_count).toBe(0)
  const output = lines.join('\n')
  return {budgetWarned: /budget/i.test(output), output, root}
}

const STRICT = "{'service-worker': 10}"
const GENEROUS = "{'service-worker': 10000000}"

describe('config layer specificity for perfBudgets', () => {
  it('browser.chrome beats a top-level default', async () => {
    const built = await build(
      project(
        `module.exports = {perfBudgets: ${GENEROUS}, browser: {chrome: {perfBudgets: ${STRICT}}}}`
      )
    )
    expect(built.budgetWarned).toBe(true)
  }, 120_000)

  it('commands.build still outranks browser.chrome', async () => {
    const built = await build(
      project(
        `module.exports = {commands: {build: {perfBudgets: ${GENEROUS}}}, browser: {chrome: {perfBudgets: ${STRICT}}}}`
      )
    )
    expect(built.budgetWarned).toBe(false)
  }, 120_000)

  it('a top-level value still applies when nothing more specific sets it', async () => {
    const strict = await build(
      project(`module.exports = {perfBudgets: ${STRICT}}`)
    )
    expect(strict.budgetWarned).toBe(true)
    const generous = await build(
      project(`module.exports = {perfBudgets: ${GENEROUS}}`)
    )
    expect(generous.budgetWarned).toBe(false)
  }, 120_000)

  it('a CLI value beats every config layer', async () => {
    const built = await build(
      project(
        `module.exports = {perfBudgets: ${GENEROUS}, browser: {chrome: {perfBudgets: ${GENEROUS}}}, commands: {build: {perfBudgets: ${GENEROUS}}}}`
      ),
      {perfBudgets: {'service-worker': 10}}
    )
    expect(built.budgetWarned).toBe(true)
  }, 120_000)
})
