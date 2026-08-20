import {spawn} from 'node:child_process'
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')

const CHROMIUM_FAMILY = [
  'chrome',
  'chromium',
  'edge',
  'brave',
  'opera',
  'vivaldi',
  'yandex',
  'chromium-based'
] as const

function stripVitestEnv(): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0'
  }
  delete env.VITEST
  delete env.VITEST_WORKER_ID
  return env
}

function runCli(args: string[], timeoutMs = 25000) {
  return new Promise<{code: number; stdout: string; stderr: string}>(
    (resolvePromise, reject) => {
      const child = spawn(process.execPath, [cliBin, ...args], {
        cwd: cliRoot,
        stdio: 'pipe',
        env: stripVitestEnv()
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(
          new Error(
            `CLI timed out: ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        )
      }, timeoutMs)
      child.on('close', (code) => {
        clearTimeout(timer)
        resolvePromise({code: code ?? 1, stdout, stderr})
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    }
  )
}

function writeUnpackedExtension(dir: string) {
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Pin Fixture',
      version: '1.0.0',
      action: {default_title: 'Pin Fixture'}
    })
  )
}

function writeFakeCanary(dir: string) {
  const binary = join(dir, 'fake-canary')
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    --version|--product-version)',
      '      echo "Canary 999.0.1234.5"',
      '      exit 0',
      '      ;;',
      '  esac',
      'done',
      'exit 0',
      ''
    ].join('\n')
  )
  chmodSync(binary, 0o755)
  return binary
}

// The fake versioned canary is a shell script; Windows cannot exec it
// (and Node refuses script spawns without a shell), so the contract runs
// on posix only. The launcher's pin path itself is platform-neutral.
describe.skipIf(process.platform === 'win32')(
  'chromium-binary pin contract',
  () => {
    const leftovers: string[] = []

    afterEach(() => {
      for (const dir of leftovers.splice(0)) {
        try {
          rmSync(dir, {recursive: true, force: true})
        } catch {
          // Ignore
        }
      }
    })

    it('refuses a missing pin on chrome instead of claiming Chrome for Testing is missing', async () => {
      const projectDir = mkdtempSync(join(tmpdir(), 'extjs-pin-missing-'))
      leftovers.push(projectDir)
      writeUnpackedExtension(projectDir)
      const missing = join(projectDir, 'no-such-canary')

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        'chrome',
        '--chromium-binary',
        missing
      ])

      const combined = `${result.stdout}\n${result.stderr}`
      expect(result.code).not.toBe(0)
      expect(combined).toMatch(/Can't find a Chromium binary at the given path/)
      expect(combined).toContain(missing)
      expect(combined).not.toMatch(/Chrome for Testing isn't available/)
      expect(combined).not.toMatch(/Install Chrome for Testing/)
      expect(combined).not.toMatch(/npx extension install chrome/)
    })

    it.each(
      CHROMIUM_FAMILY
    )('launches the named pin on --browser %s and says so on the card', async (browser) => {
      const projectDir = mkdtempSync(join(tmpdir(), `extjs-pin-${browser}-`))
      leftovers.push(projectDir)
      writeUnpackedExtension(projectDir)
      const pin = writeFakeCanary(projectDir)

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        browser,
        '--chromium-binary',
        pin
      ])

      const combined = `${result.stdout}\n${result.stderr}`
      expect(combined).not.toMatch(/Chrome for Testing isn't available/)
      expect(combined).not.toMatch(/Install Chrome for Testing/)
      expect(combined).not.toMatch(
        /Can't find a Chromium binary at the given path/
      )
      // The pin is honoured, and the card SAYS it was pinned rather than
      // echoing the path back: the user typed that path, so repeating it costs
      // the card's last row to tell them what they already know. The version
      // read off the pinned binary is the evidence it actually ran, and the
      // resolved path itself is published in ready.json for tooling.
      expect(combined).toMatch(/999\.0\.1234\.5/)
      expect(combined).toMatch(/pinned with --chromium-binary/)
      expect(combined).not.toContain(`Binary         ${pin}`)
    })
  }
)
