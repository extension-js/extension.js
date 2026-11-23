import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {plantUnspawnable} from '../helpers/browser-stand-in'
import {framesIn, runCli as spawnCli} from '../helpers/run-cli'

const GLYPH = '⏵'
const ANSI_ESCAPE = String.fromCharCode(27)

interface Frame {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string} | null
}

// Color stays on: the frame has to come out plain when the terminal block
// it was built from is fully decorated.
function runCli(args: string[], cwd: string) {
  return spawnCli(args, {cwd, env: {FORCE_COLOR: '1', NO_COLOR: undefined}})
}

// Machine frames only. A command may still write a human line to stdout
// around them, and that line is not what this contract is about.
function frames(stdout: string): Frame[] {
  return framesIn<Frame>(stdout)
}

// One failing run per place a failure frame is built: the top-level sink and
// each command's own catch.
describe('the error.message of a json failure frame', () => {
  let work = ''
  let projectDir = ''
  let emptyDir = ''
  let unexecutable = ''
  let missing = ''

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'extjs-plain-message-'))
    projectDir = join(work, 'project')
    emptyDir = join(work, 'empty')
    mkdirSync(projectDir, {recursive: true})
    mkdirSync(emptyDir, {recursive: true})
    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Plain Message Probe',
        version: '1.0.0'
      })
    )

    // Passes the pin check, then spawn refuses it: no browser starts.
    unexecutable = plantUnspawnable(join(work, 'bin'), 'chrome')
    missing = join(work, 'nowhere', 'chrome')
  })

  afterAll(() => {
    rmSync(work, {recursive: true, force: true})
  })

  const runs: Array<[string, () => string[], string]> = [
    [
      'start, a browser that cannot spawn',
      () => [
        'start',
        projectDir,
        '--browser',
        'chrome',
        '--chromium-binary',
        unexecutable
      ],
      'E_BROWSER_LAUNCH'
    ],
    [
      'start, a pin that names nothing',
      () => [
        'start',
        projectDir,
        '--browser',
        'chrome',
        '--chromium-binary',
        missing
      ],
      'E_BROWSER_BINARY_INVALID'
    ],
    [
      'preview, a pin that names nothing',
      () => [
        'preview',
        projectDir,
        '--browser',
        'chrome',
        '--chromium-binary',
        missing
      ],
      'E_BROWSER_BINARY_INVALID'
    ],
    ['start, no manifest', () => ['start', emptyDir], 'E_MANIFEST_NOT_FOUND'],
    ['build, no manifest', () => ['build', emptyDir], 'E_MANIFEST_NOT_FOUND'],
    [
      'preview, no manifest',
      () => ['preview', emptyDir],
      'E_MANIFEST_NOT_FOUND'
    ],
    [
      'dev, no manifest',
      () => ['dev', emptyDir, '--no-browser'],
      'E_MANIFEST_NOT_FOUND'
    ],
    [
      'build, a remote archive nothing serves',
      () => ['build', 'http://127.0.0.1:1/extension.zip'],
      'E_REMOTE_DOWNLOAD'
    ],
    [
      'create, a destination that holds files',
      () => ['create', projectDir],
      'E_DESTINATION_NOT_EMPTY'
    ]
  ]

  it.each(runs)(
    'carries no glyph and no escape code with color forced on: %s',
    async (_label, args, code) => {
      const result = await runCli([...args(), '--output', 'json'], work)
      const failures = frames(result.stdout).filter((frame) => !frame.ok)

      expect(result.status, result.stdout).toBe(1)
      // A run that framed nothing would pass the scan below without a look.
      expect(failures.map((frame) => frame.error?.code)).toEqual([code])

      for (const frame of failures) {
        const message = String(frame.error?.message)

        expect(message, JSON.stringify(frame)).not.toContain(GLYPH)
        expect(message, JSON.stringify(frame)).not.toContain(ANSI_ESCAPE)
        expect(message.trim()).not.toBe('')
      }
    },
    150_000
  )
})
