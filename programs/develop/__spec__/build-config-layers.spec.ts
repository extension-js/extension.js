import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'
import {writeExtensionProject} from './helpers/extension-project'

// One specificity ladder for every key that can live in more than one
// place: a top-level value is the weakest layer, browser.<vendor> beats it,
// commands.<cmd> beats both, a CLI flag beats everything.
const tempFolder = trackTempFolders()

function project(config: string) {
  const root = tempFolder('extjs-config-layers-')
  writeExtensionProject(root, {
    name: 'layers',
    manifest: {background: {service_worker: 'background.js'}}
  })

  fs.writeFileSync(
    path.join(root, 'background.js'),
    'console.log("bg");\n'.repeat(50)
  )

  fs.writeFileSync(path.join(root, 'extension.config.js'), config)

  return root
}

async function build(root: string, extra: Record<string, unknown> = {}) {
  const lines: string[] = []
  const originalWarn = console.warn
  const originalLog = console.log
  const originalError = console.error
  console.warn = (...args: unknown[]) => lines.push(args.join(' '))
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  let summary: {errors_count: number; warnings_count: number}

  try {
    summary = await buildProject(root, {
      silent: false,
      mode: 'production',
      ...extra
    })
  } finally {
    console.warn = originalWarn
    console.log = originalLog
    console.error = originalError
  }

  expect(summary.errors_count).toBe(0)
  const output = lines.join('\n')

  return {
    budgetWarned: /budget/i.test(output),
    warnings: summary.warnings_count,
    output,
    root
  }
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

  it('commands.start decides for the build that start runs', async () => {
    const strictStart = project(
      `module.exports = {perfBudgets: ${GENEROUS}, commands: {start: {perfBudgets: ${STRICT}}}}`
    )
    const generousStart = project(
      `module.exports = {perfBudgets: ${STRICT}, commands: {start: {perfBudgets: ${GENEROUS}}}}`
    )

    // The start build is silent, so the summary count is what tells.
    expect(
      (await build(strictStart, {metadataCommand: 'start'})).warnings
    ).toBeGreaterThan(0)

    expect(
      (await build(generousStart, {metadataCommand: 'start'})).warnings
    ).toBe(0)

    // A plain build never reads the start block.
    expect((await build(strictStart)).warnings).toBe(0)
    expect((await build(generousStart)).warnings).toBeGreaterThan(0)
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
