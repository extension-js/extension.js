import * as fs from 'node:fs'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {resetPerfBudgetNotices} from '../plugin-perf-budgets'
import {trackTempFolders} from './helpers/temp-folders'

// An overrun is a warning unless the author asks for a failed build, and a
// CI job that gates on size needs the exit code and the code to agree.
const makeTempFolder = trackTempFolders()

interface Diagnostic {
  code?: string
  message: string
  severity: string
  name?: string
}

interface BuildFailure extends Error {
  code?: string
  diagnostics?: Diagnostic[]
}

const PAYLOAD = 'x'.repeat(8 * 1024)

function config(perfBudgets: string): string {
  return `module.exports = {perfBudgets: ${perfBudgets}}\n`
}

function project(configSource?: string, extra: Record<string, string> = {}) {
  const root = makeTempFolder('extjs-budget-on-exceed-')

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'budget-on-exceed',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'budget-on-exceed',
      version: '1.0.0',
      options_page: 'options/index.html',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    }),
    'content/scripts.js': `console.log(${JSON.stringify(PAYLOAD)})\n`,
    'options/index.html':
      '<!doctype html><html><body><p>options</p></body></html>',
    ...extra
  }

  if (configSource) files['extension.config.js'] = configSource

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

let errorSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetPerfBudgetNotices()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  errorSpy.mockRestore()
  logSpy.mockRestore()
  warnSpy.mockRestore()
})

function printedErrors(): string {
  return errorSpy.mock.calls
    .map((call: unknown[]) =>
      stripVTControlCharacters(call.map(String).join(' '))
    )
    .join('\n')
}

async function build(root: string, mode = 'production') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as never)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

async function failureOf(root: string): Promise<BuildFailure> {
  try {
    await build(root)
  } catch (error) {
    return error as BuildFailure
  }

  throw new Error('expected the build to fail')
}

const emitted = (root: string) =>
  fs.existsSync(path.join(root, 'dist', 'chrome', 'manifest.json'))

const TIGHT = "'content-script': 1024"

describe('perfBudgets.onExceed on a real production build', () => {
  it('warns and builds when the setting is left out', async () => {
    const root = project(config(`{${TIGHT}}`))
    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBe(1)
    expect(String(summary.warnings?.[0])).toContain('W_PERF_BUDGET')
    expect(emitted(root)).toBe(true)
  }, 180_000)

  it("warns and builds with 'warn', and the key is one the plugin reads", async () => {
    const root = project(config(`{${TIGHT}, onExceed: 'warn'}`))
    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBe(1)
    expect(String(summary.warnings?.[0])).toContain('W_PERF_BUDGET')
    expect(printedErrors()).not.toContain('nothing reads')
    expect(emitted(root)).toBe(true)
  }, 180_000)

  it("fails with 'error', names the file and its budget, and writes nothing", async () => {
    const root = project(config(`{${TIGHT}, onExceed: 'error'}`))
    const failure = await failureOf(root)

    expect(failure.code).toBe('E_COMPILE')

    const errors = (failure.diagnostics || []).filter(
      (diagnostic) => diagnostic.severity === 'error'
    )

    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe('E_PERF_BUDGET')
    expect(errors[0].name).toBe('PerfBudgetError')
    expect(errors[0].message).toMatch(
      /One asset exceeds the extension performance budget\.[\s\S]*\n {2}content_scripts\/content-0\.js\n {4}size: {3}\d+\.\d KiB\n {4}budget: 1\.0 KiB {2}\(over by \d+%\)\n {4}role: {3}content script, injected on every page navigation\n/
    )

    expect(errors[0].message).toContain(
      "The build failed because perfBudgets.onExceed is 'error' in extension.config.js."
    )

    const printed = printedErrors()

    expect(printed).toContain('budget: 1.0 KiB')
    expect(printed).toContain('Build failed with 1 error.')
    expect(emitted(root)).toBe(false)
  }, 180_000)

  it("never counts an .html file, however large, under 'error'", async () => {
    const bigPage = `<!doctype html><html><body><p>${'y'.repeat(3 * 1024 * 1024)}</p></body></html>`
    const pageOnly = project(config("{onExceed: 'error'}"), {
      'options/index.html': bigPage
    })
    const summary = await build(pageOnly)

    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBe(0)
    expect(
      fs.statSync(path.join(pageOnly, 'dist', 'chrome', 'options/index.html'))
        .size
    ).toBeGreaterThan(3 * 1024 * 1024)

    const withScript = project(config(`{${TIGHT}, onExceed: 'error'}`), {
      'options/index.html': bigPage
    })
    const failure = await failureOf(withScript)
    const message = String(failure.diagnostics?.[0]?.message)

    expect(message).toContain('One asset exceeds')
    expect(message).toContain('content_scripts/content-0.')
    expect(message).not.toContain('.html')
  }, 180_000)

  it('refuses a value that is neither warn nor error, before compiling', async () => {
    const root = project(config(`{${TIGHT}, onExceed: 'fail'}`))
    const failure = await failureOf(root)

    expect(failure.code).toBe('E_CONFIG_LOAD')
    expect(stripVTControlCharacters(failure.message)).toContain(
      "perfBudgets.onExceed in extension.config.js must be 'warn' or 'error', found the string \"fail\"."
    )

    expect(emitted(root)).toBe(false)
  }, 180_000)

  it("builds in development mode with 'error', where no budget is checked", async () => {
    const root = project(config(`{${TIGHT}, onExceed: 'error'}`))
    const summary = await build(root, 'development')

    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBe(0)
    expect(emitted(root)).toBe(true)
  }, 180_000)
})
