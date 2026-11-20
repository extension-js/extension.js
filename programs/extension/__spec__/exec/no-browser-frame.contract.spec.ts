import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {everyLineAsFrame, runCli} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  command: string
  status: string
  value: {browsers?: string[]; noBrowser?: boolean} | null
}

// A frame names the browsers a run was for. Only noBrowser says whether one
// was launched, so a reader never takes a target for a running browser.
describe('a run with --no-browser says in its json frame that nothing was launched', () => {
  const leftovers: string[] = []

  afterEach(() => {
    for (const dir of leftovers.splice(0)) {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  function createProject(): string {
    const work = mkdtempSync(join(tmpdir(), 'extjs-no-browser-frame-'))
    leftovers.push(work)
    const projectDir = join(work, 'project')
    mkdirSync(projectDir)
    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'No Browser Probe',
        version: '1.0.0'
      })
    )

    return projectDir
  }

  it.each([
    ['preview', 'ready'],
    ['start', 'started']
  ] as const)(
    '%s answers %s with noBrowser true beside the target',
    async (command, status) => {
      const projectDir = createProject()
      const result = await runCli(
        [
          command,
          projectDir,
          '--browser',
          'chromium',
          '--no-browser',
          '--output',
          'json'
        ],
        {timeoutMs: 60_000}
      )

      expect(result.status, result.stderr).toBe(0)

      const frames = everyLineAsFrame<Frame>(result.stdout)

      expect(frames).toHaveLength(1)
      expect(frames[0]).toMatchObject({
        ok: true,
        command,
        status,
        value: {browsers: ['chromium'], noBrowser: true}
      })

      // The session record names the target and no browser process.
      const ready = JSON.parse(
        readFileSync(
          join(projectDir, 'dist', 'extension-js', 'chromium', 'ready.json'),
          'utf8'
        )
      ) as Record<string, unknown>

      expect(ready.browser).toBe('chromium')
      expect('browserPid' in ready).toBe(false)
      expect('binary' in ready).toBe(false)
      expect(
        existsSync(join(projectDir, 'dist', 'extension-js', 'profiles'))
      ).toBe(false)
    },
    90_000
  )

  it('preview says no-browser mode on the card and the banner in text output', async () => {
    const result = await runCli(
      ['preview', createProject(), '--browser', 'chromium', '--no-browser'],
      {timeoutMs: 60_000, env: {NO_COLOR: '1'}}
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toContain('Browser        Chromium (no-browser mode)')
    expect(result.output).toContain('Previewing on Chromium (no-browser mode).')
  }, 90_000)
})
