import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const ANSI = /\x1b\[[0-9;]*m/g

function cliBin(): string {
  const root = path.resolve(__dirname, '../..')
  const cjs = path.join(root, 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs

  return path.join(root, 'dist', 'cli.js')
}

// A stand-in for the npx the installer shells out to. It fills the --path the
// CLI hands it the way an interrupted or a finished download would, then
// exits 0 either way, which is exactly the exit code the CLI used to trust.
function writeFakeNpx(binDir: string, mode: 'truncated' | 'complete') {
  const body =
    mode === 'truncated'
      ? ': > "$dir/chrome"'
      : 'printf "#!/bin/sh\\nexit 0\\n" > "$dir/chrome" && chmod 755 "$dir/chrome"'
  const script = [
    '#!/bin/sh',
    'dest=""',
    'while [ $# -gt 0 ]; do',
    '  if [ "$1" = "--path" ]; then dest="$2"; shift; fi',
    '  shift',
    'done',
    'dir="$dest/chrome/linux-152.0.9999.1/chrome-linux64"',
    'mkdir -p "$dir"',
    body,
    'exit 0',
    ''
  ].join('\n')
  const npx = path.join(binDir, 'npx')
  fs.writeFileSync(npx, script)
  fs.chmodSync(npx, 0o755)
}

function runInstall(
  args: string[],
  env: Record<string, string>,
  binDir: string
) {
  const {npm_execpath: _npmExecPath, ...base} = process.env

  const result = spawnSync(process.execPath, [cliBin(), ...args], {
    encoding: 'utf8',
    env: {
      ...base,
      EXTENSION_ENV: 'test',
      EXTENSION_TELEMETRY: '0',
      // A plain npm agent selects npx, which the stand-in on PATH answers.
      npm_config_user_agent: 'npm/10.0.0 node/v22.0.0',
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      ...env
    }
  })

  return {
    status: result.status,
    stdout: result.stdout.replace(ANSI, ''),
    stderr: result.stderr.replace(ANSI, '')
  }
}

describe.skipIf(process.platform === 'win32')(
  'install verifies the destination before claiming success',
  () => {
    let work = ''
    let cacheRoot = ''
    let binDir = ''

    beforeEach(() => {
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-install-door-'))
      cacheRoot = path.join(work, 'cache')
      binDir = path.join(work, 'bin')
      fs.mkdirSync(binDir, {recursive: true})
    })

    afterEach(() => {
      fs.rmSync(work, {recursive: true, force: true})
    })

    it('frames a truncated download as E_BROWSER_DOWNLOAD and removes the tree', () => {
      writeFakeNpx(binDir, 'truncated')

      const result = runInstall(
        ['install', 'chrome', '--output', 'json'],
        {EXT_BROWSERS_CACHE_DIR: cacheRoot},
        binDir
      )

      expect(result.status).toBe(1)
      const lines = result.stdout.split('\n').filter((line) => line.trim())
      expect(lines).toHaveLength(1)
      const frame = JSON.parse(lines[0]) as Record<string, unknown>
      expect(frame).toMatchObject({
        schema: 1,
        ok: false,
        command: 'install',
        status: 'failed'
      })

      const error = frame.error as {code: string; message: string}
      expect(error.code).toBe('E_BROWSER_DOWNLOAD')
      expect(error.message).toContain(path.join(cacheRoot, 'chrome'))
      expect(error.message).toMatch(/non-empty executable file/)
      expect(fs.existsSync(path.join(cacheRoot, 'chrome'))).toBe(false)
    })

    it('says so in text, with no success line, and exits non-zero', () => {
      writeFakeNpx(binDir, 'truncated')

      const result = runInstall(
        ['install', 'chrome'],
        {EXT_BROWSERS_CACHE_DIR: cacheRoot},
        binDir
      )

      expect(result.status).toBe(1)
      expect(result.stdout).not.toMatch(/is installed/)
      expect(result.stderr).toMatch(/Couldn't download chrome/)
      expect(result.stderr).toContain(path.join(cacheRoot, 'chrome'))
      expect(result.stderr).toMatch(/Run the install again/)
      expect(fs.existsSync(path.join(cacheRoot, 'chrome'))).toBe(false)
    })

    it('still reports a finished download as installed', () => {
      writeFakeNpx(binDir, 'complete')

      const result = runInstall(
        ['install', 'chrome', '--output', 'json'],
        {EXT_BROWSERS_CACHE_DIR: cacheRoot},
        binDir
      )

      expect(result.status).toBe(0)
      const frame = JSON.parse(result.stdout) as Record<string, unknown>
      expect(frame).toMatchObject({
        ok: true,
        command: 'install',
        status: 'installed',
        value: {browsers: ['chrome']}
      })

      expect(
        fs.existsSync(
          path.join(
            cacheRoot,
            'chrome',
            'chrome',
            'linux-152.0.9999.1',
            'chrome-linux64',
            'chrome'
          )
        )
      ).toBe(true)
    })
  }
)
