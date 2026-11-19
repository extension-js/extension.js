import fs from 'node:fs'
import path from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'
import {runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()

// Windows names the binary chrome.exe and judges it by that name alone.
const CHROME = process.platform === 'win32' ? 'chrome.exe' : 'chrome'

// A stand-in for the npx the installer shells out to. It fills the --path the
// CLI hands it the way an interrupted or a finished download would, then
// exits 0 either way, which is exactly the exit code the CLI used to trust.
function writeFakeNpx(
  binDir: string,
  mode: 'truncated' | 'complete' | 'hangs'
) {
  const script = path.join(binDir, 'fake-npx.cjs')
  const body = [
    // An installer that never ends, for the timeout to stop.
    mode === 'hangs' ? 'setInterval(() => {}, 1000)' : '',
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    'const args = process.argv.slice(2)',
    "if (!args.includes('--path')) process.exit(2)",
    "const dest = args[args.indexOf('--path') + 1]",
    'const dir = path.join(',
    "  dest, 'chrome', 'linux-152.0.9999.1', 'chrome-linux64'",
    ')',
    'fs.mkdirSync(dir, {recursive: true})',
    `const file = path.join(dir, ${JSON.stringify(CHROME)})`,
    mode === 'complete'
      ? "fs.writeFileSync(file, '#!/bin/sh\\nexit 0\\n')"
      : "fs.writeFileSync(file, '')",
    mode === 'complete' ? 'fs.chmodSync(file, 0o755)' : '',
    ''
  ].join('\n')

  fs.writeFileSync(script, body)

  // Each launcher only hands its arguments to the script above, so the part
  // one platform cannot run is the two lines of the other platform's file.
  const npx = path.join(binDir, 'npx')

  fs.writeFileSync(
    npx,
    `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`
  )

  fs.chmodSync(npx, 0o755)

  fs.writeFileSync(
    path.join(binDir, 'npx.cmd'),
    `@echo off\r\n"${process.execPath}" "%~dp0fake-npx.cjs" %*\r\n`
  )
}

function runInstall(
  args: string[],
  env: Record<string, string>,
  binDir: string
) {
  return runCli(args, {
    env: {
      // A plain npm agent selects npx, which the stand-in on PATH answers.
      npm_config_user_agent: 'npm/10.0.0 node/v22.0.0',
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      ...env
    }
  })
}

// The npx.cmd stand-in has never run on Windows, so this stays off there
// until one Windows run of these three cases is seen to pass.
describe.skipIf(process.platform === 'win32')(
  'install verifies the destination before claiming success',
  () => {
    let work = ''
    let cacheRoot = ''
    let binDir = ''

    beforeEach(() => {
      work = makeTempFolder('extjs-install-door-')
      cacheRoot = path.join(work, 'cache')
      binDir = path.join(work, 'bin')
      fs.mkdirSync(binDir, {recursive: true})
    })

    it('frames a truncated download as E_BROWSER_DOWNLOAD and removes the tree', async () => {
      writeFakeNpx(binDir, 'truncated')

      const result = await runInstall(
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

    it('says so in text, with no success line, and exits non-zero', async () => {
      writeFakeNpx(binDir, 'truncated')

      const result = await runInstall(
        ['install', 'chrome'],
        {EXT_BROWSERS_CACHE_DIR: cacheRoot},
        binDir
      )

      expect(result.status).toBe(1)
      expect(result.stdout).not.toMatch(/is installed/)
      expect(result.stderr).toMatch(/^⏵⏵⏵ Error: Couldn't download chrome\./)
      expect(result.stderr).toContain(path.join(cacheRoot, 'chrome'))
      expect(result.stderr).toMatch(/Run the install again/)
      expect(fs.existsSync(path.join(cacheRoot, 'chrome'))).toBe(false)
    })

    // PATH is the empty bin folder alone, so no package runner can start:
    // the stand-in is not written and the machine's own npx is out of reach.
    it('frames a package runner that is not there as its own failure, not a retry', async () => {
      expect(fs.readdirSync(binDir)).toEqual([])

      const result = await runInstall(
        ['install', 'chrome', '--output', 'json'],
        {EXT_BROWSERS_CACHE_DIR: cacheRoot, PATH: binDir},
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
      expect(error.code).toBe('E_BROWSER_INSTALLER_NOT_FOUND')
      expect(error.message).toBe(
        "Couldn't install Chrome. The package runner npx wasn't found on " +
          'this machine. Install npm, or run this command through a package ' +
          'manager that is installed.'
      )

      expect(String(frame.hint)).toMatch(/^Install the package runner/)
      expect(String(frame.hint)).not.toMatch(/retry|manually/i)
      expect(fs.existsSync(path.join(cacheRoot, 'chrome'))).toBe(false)
    })

    it('stops an installer that never ends at EXTENSION_INSTALL_TIMEOUT_MS and frames it as E_BROWSER_INSTALL_TIMEOUT', async () => {
      writeFakeNpx(binDir, 'hangs')

      const result = await runInstall(
        ['install', 'chrome', '--output', 'json'],
        {
          EXT_BROWSERS_CACHE_DIR: cacheRoot,
          EXTENSION_INSTALL_TIMEOUT_MS: '3000'
        },
        binDir
      )

      expect(result.status).toBe(1)
      const lines = result.stdout.split('\n').filter((line) => line.trim())
      expect(lines).toHaveLength(1)
      const frame = JSON.parse(lines[0]) as Record<string, unknown>
      const error = frame.error as {code: string; message: string}

      expect(error.code).toBe('E_BROWSER_INSTALL_TIMEOUT')
      // Three seconds, so the stand-in has written its file by the stop.
      expect(error.message).toBe(
        "Couldn't install Chrome. The installer didn't finish within 3 seconds " +
          'and was stopped. The incomplete files were removed. Set ' +
          'EXTENSION_INSTALL_TIMEOUT_MS to a larger number of milliseconds, ' +
          'then run the install again.'
      )

      expect(frame.hint).toBe(
        'Set EXTENSION_INSTALL_TIMEOUT_MS to a larger number of milliseconds, then run the install again.'
      )

      // The broken tree and the lock are both gone, and the root stays.
      expect(fs.readdirSync(cacheRoot)).toEqual([])
    })

    // EXT_BROWSERS_CACHE_DIR pointed at an application folder, where the
    // chrome folder is a browser profile. Built from nothing, in a temp folder.
    it('refuses to install over a folder that holds a browser profile, and changes nothing in it', async () => {
      writeFakeNpx(binDir, 'complete')
      const profile = path.join(cacheRoot, 'chrome')
      fs.mkdirSync(path.join(profile, 'Default'), {recursive: true})
      fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), '{"a":1}')
      fs.writeFileSync(path.join(profile, 'Local State'), '{"b":2}')

      const result = await runInstall(
        ['install', 'chrome', '--output', 'json'],
        {EXT_BROWSERS_CACHE_DIR: cacheRoot},
        binDir
      )

      expect(result.status).toBe(1)
      const frame = JSON.parse(result.stdout) as Record<string, unknown>
      const error = frame.error as {code: string; message: string}

      expect(error.code).toBe('E_BROWSER_FOLDER_FOREIGN')
      expect(error.message).toBe(
        `Couldn't install Chrome. The folder ${profile} holds files ` +
          "Extension.js didn't put there, so nothing in it was changed. " +
          'Set EXT_BROWSERS_CACHE_DIR to a folder that only Extension.js uses.'
      )

      expect(frame.hint).toBe(
        'Set EXT_BROWSERS_CACHE_DIR to a folder that only Extension.js uses.'
      )

      expect(fs.readdirSync(cacheRoot)).toEqual(['chrome'])
      expect(fs.readdirSync(profile).sort()).toEqual(['Default', 'Local State'])
      expect(
        fs.readFileSync(path.join(profile, 'Default', 'Preferences'), 'utf8')
      ).toBe('{"a":1}')

      expect(fs.readFileSync(path.join(profile, 'Local State'), 'utf8')).toBe(
        '{"b":2}'
      )
    })

    it('still reports a finished download as installed', async () => {
      writeFakeNpx(binDir, 'complete')

      const result = await runInstall(
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
            CHROME
          )
        )
      ).toBe(true)
    })
  }
)
