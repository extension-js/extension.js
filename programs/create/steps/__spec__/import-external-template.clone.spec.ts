import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {holdTimeouts, settleOnceReady} from '../../__spec__/clock-after-ready'
import {importExternalTemplate} from '../import-external-template'

const noopLogger = {log: () => {}, error: () => {}}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

// The real clone runs against a git stand-in that answers every setup step at
// once and does on the pull what the row asks: fill the folder, fail or hang.
describe.skipIf(process.platform === 'win32')(
  'a GitHub clone through git',
  () => {
    let workDir: string
    let pidFile: string
    const started: number[] = []

    beforeEach(() => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-clone-'))
      const binDir = path.join(workDir, 'bin')
      fs.mkdirSync(binDir)
      pidFile = path.join(workDir, 'git-pull.pid')

      const git = path.join(binDir, 'git')
      fs.writeFileSync(
        git,
        [
          '#!/bin/sh',
          'case "$1" in',
          '  --version) echo "git version 2.99.0" ;;',
          '  pull)',
          '    case "$EXTJS_STAND_IN_PULL" in',
          `      hang) echo $$ > "${pidFile}"; exec sleep 30 ;;`,
          `      fill) echo '{"name":"cloned"}' > manifest.json ;;`,
          '      *) echo "fatal: couldn\'t find remote ref" >&2; exit 1 ;;',
          '    esac ;;',
          'esac',
          'exit 0',
          ''
        ].join('\n')
      )

      fs.chmodSync(git, 0o755)

      vi.stubEnv('PATH', `${binDir}${path.delimiter}${process.env.PATH ?? ''}`)
      vi.stubEnv('EXTENSION_CREATE_TIMEOUT_MS', '10000')
      vi.stubEnv('EXTENSION_ENV', 'test')
      vi.stubEnv('EXTENSION_DEBUG', '')
      vi.stubEnv('EXTENSION_AUTHOR_MODE', '')
      // go-git-it asks the GitHub API first unless it runs under test.
      vi.stubEnv('NODE_ENV', 'test')
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllEnvs()

      // Only a stand-in this row started and never saw end, so it is still ours.
      for (const pid of started.splice(0)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Already gone.
        }
      }

      fs.rmSync(workDir, {recursive: true, force: true})
    })

    function importing() {
      return importExternalTemplate(
        path.join(workDir, 'my-ext'),
        'my-ext',
        'https://github.com/acme/starter',
        noopLogger,
        {ownsProjectDir: true}
      )
    }

    it('scaffolds what the clone fetched', async () => {
      vi.stubEnv('EXTJS_STAND_IN_PULL', 'fill')

      await expect(importing()).resolves.toEqual({
        template: 'starter',
        source: 'https://github.com/acme/starter'
      })

      expect(
        fs.readFileSync(path.join(workDir, 'my-ext', 'manifest.json'), 'utf8')
      ).toBe('{"name":"cloned"}\n')
    }, 20_000)

    it('carries what git said when the clone fails', async () => {
      vi.stubEnv('EXTJS_STAND_IN_PULL', 'fail')

      const error = await importing().then(
        () => {
          throw new Error('the clone should have failed')
        },
        (reason: Error & {cause?: Error}) => reason
      )

      expect(error.name).toBe('TemplateDownloadError')
      expect(error.cause?.message).toContain("couldn't find remote ref")
      expect(fs.existsSync(path.join(workDir, 'my-ext'))).toBe(false)
    }, 20_000)

    it('gives the output back and ends the git it started on a timeout', async () => {
      vi.stubEnv('EXTJS_STAND_IN_PULL', 'hang')
      vi.stubEnv('EXTENSION_CREATE_TIMEOUT_MS', '500')
      const stdoutWrite = process.stdout.write
      const stderrWrite = process.stderr.write

      // The budget runs out only once the stand-in git hangs on the pull, so
      // the timeout always meets a git it started.
      holdTimeouts()
      const error = await settleOnceReady(
        importing().then(
          () => {
            throw new Error('the clone should have timed out')
          },
          (reason: Error) => reason
        ),
        () => fs.existsSync(pidFile)
      )
      vi.useRealTimers()

      const pid = Number(fs.readFileSync(pidFile, 'utf8').trim())
      expect(pid).toBeGreaterThan(0)
      started.push(pid)

      expect(error.name).toBe('TemplateDownloadError')
      expect(process.stdout.write).toBe(stdoutWrite)
      expect(process.stderr.write).toBe(stderrWrite)

      await vi.waitFor(() => expect(isRunning(pid)).toBe(false), {
        timeout: 5000,
        interval: 50
      })

      started.splice(started.indexOf(pid), 1)
    }, 20_000)
  }
)
