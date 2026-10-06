import {spawn} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')
const DEBUG_GLYPH = '···'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+p1a9+gAAAABJRU5ErkJggg==',
  'base64'
)

interface Frame {
  ok: boolean
  command: string
  status: string
  value: {summaries: Array<{output_path: string; total_assets: number}>}
}

function runCli(args: string[], cwd: string, timeoutMs = 120_000) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EXTENSION_ENV: 'test',
    EXTENSION_TELEMETRY: '0',
    EXTENSION_DEBUG: '1'
  }
  delete env.VITEST
  delete env.VITEST_WORKER_ID

  return new Promise<{status: number; stdout: string; stderr: string}>(
    (resolvePromise, reject) => {
      const child = spawn(process.execPath, [cliBin, ...args], {
        cwd,
        stdio: 'pipe',
        env
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()))

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`CLI did not exit: ${args.join(' ')}\n${stdout}`))
      }, timeoutMs)

      child.on('close', (code) => {
        clearTimeout(timer)
        resolvePromise({status: code ?? 1, stdout, stderr})
      })
    }
  )
}

function writeFixture(projectDir: string): void {
  mkdirSync(join(projectDir, '_locales', 'en'), {recursive: true})
  mkdirSync(join(projectDir, '_locales', 'pt_BR'), {recursive: true})
  mkdirSync(join(projectDir, 'icons'), {recursive: true})
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'debug-stdout-probe',
      private: true,
      version: '1.0.0'
    })
  )

  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: '__MSG_appName__',
      description: '__MSG_appDesc__',
      version: '1.0.0',
      default_locale: 'en',
      icons: {16: 'icons/icon16.png', 48: 'icons/icon48.png'},
      action: {default_popup: 'popup.html', default_icon: 'icons/icon16.png'},
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content.js'], css: ['content.css']}
      ]
    })
  )

  writeFileSync(
    join(projectDir, '_locales', 'en', 'messages.json'),
    JSON.stringify({
      appName: {message: 'Debug Stdout Probe'},
      appDesc: {message: 'trips the locales, icons and css debug lines'}
    })
  )

  writeFileSync(
    join(projectDir, '_locales', 'pt_BR', 'messages.json'),
    JSON.stringify({appName: {message: 'Sonda'}})
  )

  writeFileSync(join(projectDir, 'icons', 'icon16.png'), PNG_1X1)
  writeFileSync(join(projectDir, 'icons', 'icon48.png'), PNG_1X1)
  writeFileSync(
    join(projectDir, 'popup.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="popup.css"></head><body><p>probe</p><script src="popup.js"></script></body></html>\n'
  )

  writeFileSync(
    join(projectDir, 'popup.css'),
    'body { color: rebeccapurple }\n'
  )

  writeFileSync(join(projectDir, 'popup.js'), "console.log('popup')\n")
  writeFileSync(
    join(projectDir, 'content.js'),
    "document.documentElement.dataset.debugStdoutProbe = '1'\n"
  )

  writeFileSync(
    join(projectDir, 'content.css'),
    '.debug-stdout-probe { outline: 1px solid red }\n'
  )
}

describe('build --output json with diagnostics on', () => {
  let work = ''
  let projectDir = ''

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'extjs-debug-stdout-'))
    projectDir = join(work, 'debug-stdout-probe')
    writeFixture(projectDir)
  })

  afterAll(() => {
    rmSync(work, {recursive: true, force: true})
  })

  it('keeps stdout to the one envelope and sends every debug line to stderr', async () => {
    const result = await runCli(['build', projectDir, '--output', 'json'], work)
    const stdoutLines = result.stdout.split('\n').filter((line) => line)

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(stdoutLines, result.stdout).toHaveLength(1)

    const frame = JSON.parse(stdoutLines[0]) as Frame
    expect(frame.ok).toBe(true)
    expect(frame.command).toBe('build')
    expect(frame.status).toBe('built')
    expect(frame.value.summaries[0].output_path).toContain('debug-stdout-probe')

    const debugLines = result.stderr
      .split('\n')
      .filter((line) => line.includes(DEBUG_GLYPH))
    expect(debugLines.length, result.stderr).toBeGreaterThan(10)

    for (const feature of ['locales', 'icons', 'css', 'manifest']) {
      expect(
        debugLines.some((line) => line.includes(` ${feature} `)),
        `${feature} debug line expected on stderr\n${result.stderr}`
      ).toBe(true)
    }

    expect(result.stderr).toContain('locales  emitted=2')
    expect(result.stdout).not.toContain(DEBUG_GLYPH)
  }, 150_000)
})
