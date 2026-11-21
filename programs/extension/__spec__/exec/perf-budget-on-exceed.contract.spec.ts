import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {framesIn, runCli} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  command: string
  status: string
  warnings: string[]
  error: {
    code: string
    message: string
    details?: Array<{code?: string; severity?: string; message: string}>
  } | null
}

const PAYLOAD = 'x'.repeat(8 * 1024)
const WHY = "The build failed because perfBudgets.onExceed is 'error'"

// A CI job that gates on size reads the exit code and the frame, so both
// have to say the same thing about a file over its budget.
describe('perfBudgets.onExceed through the CLI', () => {
  const leftovers: string[] = []

  afterEach(() => {
    for (const dir of leftovers.splice(0)) {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  function project(onExceed?: 'warn' | 'error'): string {
    const work = mkdtempSync(join(tmpdir(), 'extjs-budget-exit-'))

    leftovers.push(work)

    const dir = join(work, 'project')

    mkdirSync(join(dir, 'content'), {recursive: true})
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({private: true, name: 'budget-exit', version: '0.0.0'})
    )

    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Budget Exit',
        version: '1.0.0',
        content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
      })
    )

    writeFileSync(
      join(dir, 'content', 'scripts.js'),
      `console.log(${JSON.stringify(PAYLOAD)})\n`
    )

    writeFileSync(
      join(dir, 'extension.config.js'),
      `module.exports = {perfBudgets: {'content-script': 1024${
        onExceed ? `, onExceed: '${onExceed}'` : ''
      }}}\n`
    )

    return dir
  }

  const built = (dir: string) =>
    existsSync(join(dir, 'dist', 'chromium', 'manifest.json'))

  it('fails build --output json with exit 1 and one frame that carries E_PERF_BUDGET, and writes nothing', async () => {
    const dir = project('error')
    const run = await runCli(['build', dir, '--output', 'json'], {
      env: {EXTENSION_DEBUG: '0'}
    })
    const frames = framesIn<Frame>(run.stdout)

    expect(run.status, run.output).toBe(1)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      ok: false,
      command: 'build',
      status: 'build-failed',
      error: {code: 'E_COMPILE'}
    })

    const errors = (frames[0].error?.details || []).filter(
      (detail) => detail.severity === 'error'
    )

    expect(errors.map((detail) => detail.code)).toEqual(['E_PERF_BUDGET'])
    expect(errors[0].message).toContain('content_scripts/content-0.js')
    expect(errors[0].message).toContain(WHY)
    expect(built(dir)).toBe(false)
  }, 120_000)

  it('fails a text build with exit 1 and says why on stderr', async () => {
    const dir = project('error')
    const run = await runCli(['build', dir], {env: {EXTENSION_DEBUG: '0'}})

    expect(run.status, run.output).toBe(1)
    expect(run.stderr).toContain(WHY)
    expect(run.stderr).toContain('Build failed with 1 error.')
    expect(built(dir)).toBe(false)
  }, 120_000)

  it.each([
    ['left out', undefined],
    ["'warn'", 'warn']
  ] as const)(
    'builds with exit 0 and a W_PERF_BUDGET warning in the frame when the setting is %s',
    async (_name, onExceed) => {
      const dir = project(onExceed)
      const run = await runCli(['build', dir, '--output', 'json'], {
        env: {EXTENSION_DEBUG: '0'}
      })
      const frames = framesIn<Frame>(run.stdout)

      expect(run.status, run.output).toBe(0)
      expect(frames).toHaveLength(1)
      expect(frames[0]).toMatchObject({ok: true, status: 'built'})
      expect(frames[0].warnings.join('\n')).toContain('W_PERF_BUDGET')
      expect(built(dir)).toBe(true)
    },
    120_000
  )
})
