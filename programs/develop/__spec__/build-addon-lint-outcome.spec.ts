import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest'
import type {
  AddonLintOutput,
  LoadAddonLinter,
  RunAddonLintInput
} from '../lib/addon-lint'
import type {BuildSummary} from '../lib/build-summary'
import {buildSummaryPath} from '../lib/session-paths'

const injected = vi.hoisted(() => ({
  override: {} as Partial<Pick<RunAddonLintInput, 'loadLinter' | 'timeoutMs'>>
}))

vi.mock('../lib/addon-lint', async (importActual) => {
  const actual = await importActual<typeof import('../lib/addon-lint')>()

  return {
    ...actual,
    runAddonLint: (input: RunAddonLintInput) =>
      actual.runAddonLint({...input, ...injected.override})
  }
})

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

afterEach(() => {
  injected.override = {}
})

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, '')
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-addon-lint-out-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'lintme', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("hi")\n')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'lintme',
      version: '1.0.0',
      manifest_version: 2,
      browser_specific_settings: {gecko: {id: 'lintme@example.com'}},
      background: {scripts: ['background.js']}
    })
  )

  return root
}

function linterReturning(output: AddonLintOutput): LoadAddonLinter {
  return async () => ({
    createInstance: () => ({run: async () => output})
  })
}

const hanging: LoadAddonLinter = async () => ({
  createInstance: () => ({run: () => new Promise(() => {})})
})

const crashing: LoadAddonLinter = async () => ({
  createInstance: () => ({
    run: async () => {
      throw new Error('boom')
    }
  })
})

const absent: LoadAddonLinter = async () => {
  throw new Error('[AMO] addons-linter could not be resolved.')
}

async function build(
  root: string,
  options: {addonLint?: boolean; debug?: boolean} = {}
) {
  const {extensionBuild} = await import('../command-build')
  const env = {
    VITEST: process.env.VITEST,
    EXTENSION_DEBUG: process.env.EXTENSION_DEBUG,
    EXTENSION_AUTHOR_MODE: process.env.EXTENSION_AUTHOR_MODE
  }
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE
  if (options.debug) process.env.EXTENSION_DEBUG = '1'
  else delete process.env.EXTENSION_DEBUG

  const lines: string[] = []
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.warn = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  let summary: BuildSummary

  try {
    summary = await extensionBuild(root, {
      browser: 'firefox',
      silent: false,
      install: false,
      mode: 'production',
      addonLint: options.addonLint,
      exitOnError: false
    } as any)
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError

    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  const receipt = JSON.parse(
    fs.readFileSync(buildSummaryPath(root, 'firefox'), 'utf8')
  ) as BuildSummary

  return {summary, receipt, output: stripAnsi(lines.join('\n'))}
}

describe('the store check outcome after a production firefox build', () => {
  it('says so on the console when the linter times out, without debug', async () => {
    injected.override = {loadLinter: hanging, timeoutMs: 20}
    const {summary, receipt, output} = await build(project())

    expect(summary.errors_count).toBe(0)
    expect(output).toContain('built for production')
    expect(output).toContain(
      'Store check for addons.mozilla.org did not finish: addons-linter timed out after 0 s.'
    )

    expect(output).toMatch(/npx addons-linter .*dist[\\/]firefox/)
    expect(output).not.toContain('addon-lint failed=true')
    expect(summary.addon_lint).toEqual({
      status: 'failed',
      reason: 'addons-linter timed out after 0 s'
    })

    expect(receipt.addon_lint).toEqual(summary.addon_lint)
    expect(summary.warnings_count).toBe(receipt.warnings_count)
  }, 180_000)

  it('says so on the console when the linter crashes, plus the debug line under debug', async () => {
    injected.override = {loadLinter: crashing}
    const {summary, receipt, output} = await build(project(), {debug: true})

    expect(summary.errors_count).toBe(0)
    expect(output).toContain(
      'Store check for addons.mozilla.org did not finish: addons-linter crashed: boom.'
    )

    expect(output).toContain(
      'addon-lint failed=true reason="addons-linter crashed: boom"'
    )

    expect(output).not.toContain('addon-lint skipped=true')
    expect(receipt.addon_lint).toEqual({
      status: 'failed',
      reason: 'addons-linter crashed: boom'
    })
  }, 180_000)

  it('stays quiet on a clean lint and records that it ran', async () => {
    injected.override = {loadLinter: linterReturning({errors: [], warnings: []})}
    const {summary, receipt, output} = await build(project())

    expect(summary.errors_count).toBe(0)
    expect(output).not.toContain('Store check')
    expect(output).not.toContain('AMO warning')
    expect(summary.addon_lint).toEqual({status: 'linted', findings: 0})
    expect(receipt.addon_lint).toEqual({status: 'linted', findings: 0})
  }, 180_000)

  it('prints the findings as warnings and counts them', async () => {
    injected.override = {
      loadLinter: linterReturning({
        errors: [],
        warnings: [
          {code: 'DANGEROUS_EVAL', message: 'eval can be harmful.', file: 'x.js'}
        ]
      })
    }

    const {summary, receipt, output} = await build(project())

    expect(summary.errors_count).toBe(0)
    expect(output).toContain('AMO warning DANGEROUS_EVAL: eval can be harmful.')
    expect(output).not.toContain('did not finish')
    expect(summary.addon_lint).toEqual({status: 'linted', findings: 1})
    expect(receipt.addon_lint).toEqual({status: 'linted', findings: 1})
    expect(receipt.warnings_count).toBe(summary.warnings_count)
    expect(
      (receipt.warnings || []).some((line) => line.includes('DANGEROUS_EVAL'))
    ).toBe(true)
  }, 180_000)

  it('records a missing linter and a disabled check as what they are', async () => {
    injected.override = {loadLinter: absent}
    const missing = await build(project())
    expect(missing.receipt.addon_lint).toEqual({status: 'missing'})

    injected.override = {loadLinter: crashing}
    const off = await build(project(), {addonLint: false})
    expect(off.output).not.toContain('Store check')
    expect(off.receipt.addon_lint).toEqual({
      status: 'skipped',
      reason: 'disabled'
    })
  }, 180_000)
})
