import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {everyLineAsFrame, runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'
import {normalizeFrame, normalizeTranscript} from '../helpers/transcript'

const makeTempFolder = trackTempFolders()

type ErrorFrame = {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string}
}

// One mistake, a folder that is not there, gets one answer on four commands:
// a usage frame that names the folder, before any build or browser.
describe('a project folder that does not exist', () => {
  // The CLI prints the path it resolved, which on macOS is under /private.
  const work = fs.realpathSync(makeTempFolder('extjs-no-project-'))
  const missing = path.join(work, 'nope-dir')
  const message = `No project folder at ${missing}.`

  it.each([
    ['build', []],
    ['start', ['--no-browser']],
    ['dev', ['--no-browser']],
    ['preview', ['--no-browser']]
  ])('%s answers E_PROJECT_NOT_FOUND as usage', async (command, flags) => {
    const run = await runCli(
      [command, 'nope-dir', ...flags, '--output', 'json'],
      {cwd: work}
    )
    const frames = everyLineAsFrame<ErrorFrame>(run.stdout)

    expect(run.status, run.output).toBe(1)
    expect(run.stderr).toBe('')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ok: false, command, status: 'usage'})
    expect(frames[0].error.code).toBe('E_PROJECT_NOT_FOUND')
    expect(frames[0].error.message.slice(0, message.length)).toBe(message)
  })

  it('prints the same block on stderr in text mode and exits 1', async () => {
    const run = await runCli(['build', 'nope-dir'], {cwd: work})

    expect(run.status).toBe(1)
    expect(run.stdout).toBe('')
    expect(run.stderr.slice(0, message.length + 11)).toBe(
      `⏵⏵⏵ Error: ${message}`
    )
  })
})

// What one command answers before any browser, with the folder it was given.
interface RefusalRow {
  code: string
  label: string
  setup: (dir: string) => {
    args: string[]
    cwd?: string
    env?: Record<string, string>
  }
  expected: {
    status: number | null
    signal: string | null
    frames: unknown[]
    stderr: string
  }
}

const mv3 = {manifest_version: 3, name: 'Refused', version: '1.0.0'}

function put(file: string, body: unknown): void {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body))
}

const REFUSALS: RefusalRow[] = [
  // Pins current behavior: a not-found message, a generic hint and an empty
  // stderr for a manifest that sits in public.
  {
    code: 'E_MANIFEST_IN_PUBLIC',
    label: 'build pointed at the public folder that holds the manifest',
    setup: (dir) => {
      put(path.join(dir, 'package.json'), {name: 'refused'})
      put(path.join(dir, 'public', 'manifest.json'), mv3)

      return {args: ['build', path.join(dir, 'public')]}
    },
    expected: {
      status: 1,
      signal: null,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'build',
          status: 'build-failed',
          value: null,
          error: {
            code: 'E_MANIFEST_IN_PUBLIC',
            message:
              'Manifest file not found.\nNOT FOUND <dir>/manifest.json\nEnsure the path to your extension exists, then try again.'
          },
          warnings: [],
          hint: 'Fix the error above and run build again.'
        }
      ],
      stderr: [''].join('\n')
    }
  },
  {
    code: 'E_COMPANION_EXTENSION_PATH',
    label: 'build of a root whose only manifest is a companion',
    setup: (dir) => {
      put(path.join(dir, 'package.json'), {name: 'refused'})
      put(
        path.join(dir, 'extensions', 'extension-js-devtools', 'manifest.json'),
        mv3
      )

      return {args: ['build', dir]}
    },
    expected: {
      status: 1,
      signal: null,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'build',
          status: 'build-failed',
          value: null,
          error: {
            code: 'E_COMPANION_EXTENSION_PATH',
            message:
              "Manifest file not found.\nNOT FOUND <dir>/manifest.json\nThe only manifest.json here belongs to a companion extension under extensions/.\nCompanions load next to your extension and never stand in for it.\nCOMPANION extensions/extension-js-devtools\nAdd a manifest.json at the project root or in src/, or point Extension.js at your extension's directory."
          },
          warnings: [],
          hint: 'Fix the error above and run build again.'
        }
      ],
      stderr: [''].join('\n')
    }
  },
  {
    code: 'E_LOCAL_ZIP_NOT_FOUND',
    label: 'build of a .zip file that is not an archive',
    setup: (dir) => {
      put(path.join(dir, 'bad.zip'), 'not a zip')

      return {args: ['build', path.join(dir, 'bad.zip')]}
    },
    expected: {
      status: 1,
      signal: null,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'build',
          status: 'build-failed',
          value: null,
          error: {
            code: 'E_LOCAL_ZIP_NOT_FOUND',
            message:
              "The file isn't a ZIP archive that can be unpacked.\nPATH <dir>/bad.zip\nCheck that the file opens as a ZIP, then try again."
          },
          warnings: [],
          hint: 'Fix the error above and run build again.'
        }
      ],
      stderr: [''].join('\n')
    }
  },
  {
    code: 'E_DEV_SESSION_DIST_SHARED',
    label: 'build into the dist a live dev session owns',
    setup: (dir) => {
      put(path.join(dir, 'package.json'), {name: 'refused'})
      put(path.join(dir, 'manifest.json'), mv3)
      // This test runner is the live owner, so the pid answers alive.
      put(path.join(dir, 'dist', 'extension-js', 'chromium', 'ready.json'), {
        command: 'dev',
        status: 'ready',
        pid: process.pid,
        distPath: path.join(dir, 'dist', 'chromium')
      })

      return {args: ['build', dir]}
    },
    expected: {
      status: 1,
      signal: null,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'build',
          status: 'build-failed',
          value: null,
          error: {
            code: 'E_DEV_SESSION_DIST_SHARED',
            message:
              'A dev session (PID <runner>) owns <dir>/dist/chromium, so this build was not written.\nStop that session, or pass --out-dir <path> to write the chromium build next to it and keep the dev session as it is.'
          },
          warnings: [],
          hint: 'Fix the error above and run build again.'
        }
      ],
      stderr: [
        '⏵⏵⏵ Error: A dev session (PID <runner>) owns <dir>/dist/chromium, so this build was not written.',
        'Stop that session, or pass --out-dir <path> to write the chromium build next to it and keep the dev session as it is.',
        '⏵⏵⏵ Error: Build failed with 1 error.',
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_COMMAND_UNSUPPORTED_FOR_TARGET',
    label: 'start on safari',
    setup: (dir) => {
      put(path.join(dir, 'manifest.json'), mv3)

      return {args: ['start', dir, '--browser', 'safari']}
    },
    expected: {
      status: 1,
      signal: null,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'start',
          status: 'usage',
          value: null,
          error: {
            code: 'E_COMMAND_UNSUPPORTED_FOR_TARGET',
            message: 'Safari is not supported by start.'
          },
          warnings: []
        }
      ],
      stderr: [''].join('\n')
    }
  },
  {
    code: 'E_DESTINATION_NOT_WRITABLE',
    label: 'create under a path that is a file',
    setup: (dir) => {
      put(path.join(dir, 'file'), 'x')

      return {args: ['create', path.join(dir, 'file', 'x')]}
    },
    expected: {
      status: 1,
      signal: null,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'create',
          status: 'failed',
          value: null,
          error: {
            code: 'E_DESTINATION_NOT_WRITABLE',
            message:
              "Couldn't write to the destination directory.\nPATH <dir>/file/x\nREASON ENOTDIR: not a directory, mkdir '<dir>/file/x'\nChoose a writable path, or update the folder permissions."
          },
          warnings: []
        }
      ],
      stderr: [
        ' ',
        ' 🧩 Extension.js <version>',
        '    Extension      x',
        '    Template       typescript',
        '    Output         <dir>/file/x',
        ' ',
        '⏵⏵⏵ Creating the extension x…',
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_TELEMETRY_WRITE',
    label: 'telemetry disable with every storage candidate a file',
    setup: (dir) => {
      const blocked = path.join(dir, 'blocked')

      put(blocked, 'x')

      return {
        args: ['telemetry', 'disable'],
        cwd: dir,
        env: {
          XDG_CONFIG_HOME: blocked,
          XDG_CACHE_HOME: blocked,
          TMPDIR: blocked,
          TEMP: blocked,
          TMP: blocked
        }
      }
    },
    expected: {
      status: 1,
      signal: null,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'telemetry',
          status: 'failed',
          value: null,
          error: {
            code: 'E_TELEMETRY_WRITE',
            message: 'Could not write telemetry consent file.'
          },
          warnings: [],
          hint: 'Check write permissions on the consent file path.'
        }
      ],
      stderr: [''].join('\n')
    }
  },
  {
    code: 'E_PARENT_GONE',
    label: 'dev told to follow a parent pid that is gone',
    // Gone before the engine loads: one frame and exit 1, no signal.
    setup: (dir) => {
      put(path.join(dir, 'manifest.json'), mv3)

      return {
        args: ['dev', dir, '--no-browser', '--parent-pid', '999999999']
      }
    },
    expected: {
      status: 1,
      signal: null,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'dev',
          status: 'failed',
          value: null,
          error: {
            code: 'E_PARENT_GONE',
            message:
              'the --parent-pid owner (process 999999999) is gone, so this dev session is shutting down'
          },
          warnings: []
        }
      ],
      stderr: [
        '⏵⏵⏵ Error: Parent process 999999999 is gone (--parent-pid). Shutting down.',
        ''
      ].join('\n')
    }
  }
]

// Rows written for posix: native path separators and the ENOTDIR text.
describe.skipIf(process.platform === 'win32')(
  'a refusal one command gives before any browser, read whole',
  () => {
    it.each(REFUSALS)('$code: $label', async ({setup, expected}) => {
      const dir = fs.realpathSync(makeTempFolder('extjs-refusal-'))
      const {args, cwd, env} = setup(dir)
      const run = await runCli([...args, '--output', 'json'], {cwd, env})
      const placeholders: Array<[string, string]> = [
        [dir, '<dir>'],
        [`PID ${process.pid}`, 'PID <runner>']
      ]
      const actual = {
        status: run.status,
        signal: run.signal,
        frames: everyLineAsFrame(run.stdout).map((frame) =>
          normalizeFrame(frame, placeholders)
        ),
        stderr: normalizeTranscript(run.stderr, placeholders)
      }

      expect(actual).toEqual(expected)
    })
  }
)
