import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {runCli as spawnCli} from '../helpers/run-cli'

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

// The pin is a stand-in script in a temp folder, so the launch code runs
// for real and no installed browser is ever named.
function runCli(args: string[]) {
  return spawnCli(args, {timeoutMs: 25_000})
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

      // The whole of stderr, so no install advice can ride along.
      expect(result.status).toBe(1)
      expect(result.stderr).toBe(
        "⏵⏵⏵ Error: Can't find a Chromium binary at the given path.\n" +
          `NOT FOUND ${missing}\n` +
          'Pass --chromium-binary <abs-path> with a working path.\n'
      )

      expect(result.stdout).not.toMatch(/Chrome for Testing/)
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

      const combined = result.output
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
