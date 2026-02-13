import {describe, expect, it} from 'vitest'
import {spawn} from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {
  buildContentScriptProbePlan,
  extractUpdatedHtmlFromNdjson
} from '../../../develop/webpack/plugin-browsers/run-chromium/chromium-source-inspection/deterministic-hmr-harness'

function cliRoot(): string {
  return path.resolve(__dirname, '../..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (existsSync(cjs)) return cjs
  return path.join(cliRoot(), 'dist', 'cli.js')
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(
  check: () => boolean,
  timeoutMs: number,
  intervalMs = 150
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (check()) return true
    await wait(intervalMs)
  }
  return false
}

function writeFixtureScript(
  filePath: string,
  probeId: string,
  version: string
) {
  const source =
    `const PROBE_ID = '${probeId}'\n` +
    `const PROBE_VERSION = '${version}'\n\n` +
    `export default function init() {\n` +
    `  let marker = document.getElementById(PROBE_ID)\n` +
    `  if (!marker) {\n` +
    `    marker = document.createElement('div')\n` +
    `    marker.id = PROBE_ID\n` +
    `    marker.setAttribute('style', 'position:fixed;left:8px;bottom:8px;z-index:2147483647;background:#111;color:#fff;padding:2px 6px;font:11px monospace;')\n` +
    `    ;(document.body || document.documentElement).appendChild(marker)\n` +
    `  }\n` +
    `  marker.textContent = PROBE_ID + ':' + PROBE_VERSION\n` +
    `  return () => {\n` +
    `    const current = document.getElementById(PROBE_ID)\n` +
    `    if (current) current.remove()\n` +
    `  }\n` +
    `}\n`

  writeFileSync(filePath, source, 'utf8')
}

describe('dev content-script HMR contract (live)', () => {
  const shouldRun = process.env.EXTENSION_LIVE_HMR_CONTRACT === '1'
  const chromiumBinary =
    process.env.EXTENSION_LIVE_CHROMIUM_BINARY ||
    '/Users/cezaraugusto/Library/Caches/extension.js/browsers/chromium/chromium/mac_arm-1547077/chrome-mac/Chromium.app/Contents/MacOS/Chromium'

  const maybeIt = shouldRun ? it : it.skip

  maybeIt(
    'iterates manifest content scripts and prints deterministic pass/fail matrix',
    async () => {
      expect(existsSync(chromiumBinary)).toBe(true)

      const tempRoot = mkdtempSync(
        path.join(tmpdir(), 'extjs-live-hmr-contract-')
      )
      const projectDir = path.join(tempRoot, 'fixture-extension')
      const srcDir = path.join(projectDir, 'src', 'content_scripts')
      mkdirSync(srcDir, {recursive: true})

      const manifest = {
        manifest_version: 3,
        name: 'Live HMR Contract Fixture',
        version: '0.0.1',
        content_scripts: [
          {
            matches: ['<all_urls>'],
            run_at: 'document_end',
            js: [
              'src/content_scripts/alpha.js',
              'src/content_scripts/beta.js',
              'src/content_scripts/gamma.js'
            ]
          }
        ]
      }

      writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify(
          {
            name: 'extjs-live-hmr-contract-fixture',
            private: true,
            version: '0.0.1'
          },
          null,
          2
        ),
        'utf8'
      )
      writeFileSync(
        path.join(projectDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      )

      const probePlan = buildContentScriptProbePlan(manifest)
      for (const [idx, probe] of probePlan.entries()) {
        const absScriptPath = path.join(projectDir, probe.scriptPath)
        mkdirSync(path.dirname(absScriptPath), {recursive: true})
        writeFixtureScript(absScriptPath, probe.probeId, `v${idx + 1}`)
      }

      const profileDir = path.join(tempRoot, 'profile')
      const sourceProbeSelectors = probePlan
        .map((probe) => `#${probe.probeId}`)
        .join(',')

      const child = spawn(
        process.execPath,
        [
          cliBin(),
          'dev',
          projectDir,
          '--browser',
          'chromium',
          '--chromium-binary',
          chromiumBinary,
          '--profile',
          profileDir,
          '--source',
          'https://example.com',
          '--watch-source',
          '--source-format',
          'ndjson',
          '--source-dom',
          '--source-diff',
          '--source-probe',
          sourceProbeSelectors,
          '--log-format',
          'ndjson',
          '--logs',
          'off',
          '--author'
        ],
        {
          cwd: cliRoot(),
          stdio: 'pipe',
          detached: true,
          env: {...process.env, EXTENSION_ENV: 'test'}
        }
      )

      let combinedOutput = ''
      child.stdout?.on('data', (chunk) => {
        combinedOutput += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        combinedOutput += String(chunk)
      })

      const cleanup = () => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM')
        } catch {
          try {
            child.kill('SIGTERM')
          } catch {
            // ignore
          }
        }
        try {
          rmSync(tempRoot, {recursive: true, force: true})
        } catch {
          // ignore
        }
      }

      try {
        const booted = await waitFor(
          () =>
            /compiled successfully/i.test(combinedOutput) &&
            extractUpdatedHtmlFromNdjson(combinedOutput).length > 0,
          90000
        )
        expect(booted).toBe(true)

        const matrix: Array<{
          scriptPath: string
          expectedToken: string
          passed: boolean
        }> = []

        for (const [idx, probe] of probePlan.entries()) {
          const scriptAbsPath = path.join(projectDir, probe.scriptPath)
          const nextVersion = `v${idx + 2}`
          const expectedToken = `${probe.probeId}:${nextVersion}`
          const beforeCount =
            extractUpdatedHtmlFromNdjson(combinedOutput).length

          writeFixtureScript(scriptAbsPath, probe.probeId, nextVersion)

          const observed = await waitFor(() => {
            const snapshots = extractUpdatedHtmlFromNdjson(combinedOutput)
            if (snapshots.length <= beforeCount) return false
            return snapshots[snapshots.length - 1]?.includes(expectedToken)
          }, 90000)

          matrix.push({
            scriptPath: probe.scriptPath,
            expectedToken,
            passed: observed
          })
        }

        // Print machine-readable matrix for CI and local diagnostics.
        // eslint-disable-next-line no-console
        console.log(
          '[dev-hmr-contract] matrix=' +
            JSON.stringify(
              matrix.map((item, idx) => ({
                index: idx + 1,
                script: item.scriptPath,
                expected: item.expectedToken,
                status: item.passed ? 'PASS' : 'FAIL'
              })),
              null,
              2
            )
        )

        const allPassed = matrix.every((entry) => entry.passed)
        if (!allPassed) {
          const tail = combinedOutput.slice(-4000)
          // eslint-disable-next-line no-console
          console.log('[dev-hmr-contract] output-tail=' + JSON.stringify(tail))
        }

        expect(allPassed).toBe(true)
      } finally {
        cleanup()
      }
    },
    240000
  )
})
