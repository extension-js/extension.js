import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
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
// once and hangs on the pull, the way a stalled network looks.
describe.skipIf(process.platform === 'win32')(
  'a GitHub clone that times out',
  () => {
    let workDir: string
    let pidFile: string
    const started: number[] = []

    beforeEach(() => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-clone-timeout-'))
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
          `  pull) echo $$ > "${pidFile}"; exec sleep 30 ;;`,
          'esac',
          'exit 0',
          ''
        ].join('\n')
      )

      fs.chmodSync(git, 0o755)

      vi.stubEnv('PATH', `${binDir}${path.delimiter}${process.env.PATH ?? ''}`)
      vi.stubEnv('EXTENSION_CREATE_TIMEOUT_MS', '500')
      vi.stubEnv('EXTENSION_ENV', 'test')
      vi.stubEnv('EXTENSION_DEBUG', '')
      vi.stubEnv('EXTENSION_AUTHOR_MODE', '')
      // go-git-it asks the GitHub API first unless it runs under test.
      vi.stubEnv('NODE_ENV', 'test')
    })

    afterEach(() => {
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

    it('gives the output back and ends the git it started', async () => {
      const stdoutWrite = process.stdout.write
      const stderrWrite = process.stderr.write

      const error = await importExternalTemplate(
        path.join(workDir, 'my-ext'),
        'my-ext',
        'https://github.com/acme/starter',
        noopLogger,
        {ownsProjectDir: true}
      ).then(
        () => {
          throw new Error('the clone should have timed out')
        },
        (reason: Error) => reason
      )

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
