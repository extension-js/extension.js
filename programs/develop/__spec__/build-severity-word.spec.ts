import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A build read through a pipe has no color, so the warning it counts and
// the error it fails on are found by their word. The frames a machine reads
// carry the sentences alone, the same before and after the word was added.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const CLI_DIST = path.join(
  REPO_ROOT,
  'programs',
  'extension',
  'dist',
  'cli.cjs'
)
const GLYPH = '⏵⏵⏵'
const roots: string[] = []

const AMO_WARNING =
  'addons.mozilla.org requires browser_specific_settings.gecko.data_collection_permissions for new add-ons.'

// Captured from a build of this fixture before the word existed.
const WARNING_FRAME_TEXT =
  `W_STORE_READINESS: ${AMO_WARNING}\n` +
  "The extension's owner declares what the extension collects. The build proposes no value.\n" +
  'See https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/ for the accepted values.'
const ERROR_FRAME = {
  code: 'E_COMPILE',
  message: 'Build failed with errors',
  details: [
    {
      code: 'E_MODULE_NOT_FOUND',
      message:
        "Module not found: Can't resolve './missing-file.js' in 'src'\n" +
        '   ╭─[1:0]\n' +
        " 1 │ import { nope } from './missing-file.js';\n" +
        '   · ─────────────────────────────────────────\n' +
        ' 2 │ console.log(nope);\n' +
        '   ╰────',
      file: 'src/background.js',
      line: 1,
      column: 1,
      severity: 'error'
    }
  ]
}

function ensureCliBuilt(): boolean {
  if (fs.existsSync(CLI_DIST)) return true

  const result = spawnSync(
    'pnpm',
    ['-C', 'programs/extension', 'run', 'compile'],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    }
  )

  return result.status === 0 && fs.existsSync(CLI_DIST)
}

function scaffold(background: string) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-severity-word-'))
  )
  roots.push(root)

  const files: Record<string, string> = {
    'package.json': JSON.stringify({name: 'quote-keeper', private: true}),
    'src/manifest.json': JSON.stringify({
      name: 'Quote Keeper',
      version: '1.1.0',
      manifest_version: 3,
      description: 'Keeps quotes.',
      background: {scripts: ['background.js']},
      browser_specific_settings: {gecko: {id: 'quote@example.com'}}
    }),
    'src/background.js': background
  }

  for (const [relative, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), {recursive: true})
    fs.writeFileSync(path.join(root, relative), contents)
  }

  return root
}

function build(root: string, color: 'off' | 'on', flags: string[] = []) {
  // The spec runner's own marks are not part of a user's shell.
  const {
    NO_COLOR: _noColor,
    FORCE_COLOR: _forceColor,
    CI: _ci,
    VITEST: _vitest,
    ...env
  } = process.env

  return spawnSync(
    process.execPath,
    [CLI_DIST, 'build', '--browser=firefox', '--no-addon-lint', ...flags],
    {
      cwd: root,
      encoding: 'utf-8',
      timeout: 120_000,
      env: {
        ...env,
        EXTENSION_TELEMETRY_DISABLED: '1',
        DO_NOT_TRACK: '1',
        // Node's own warnings would sit above the lines this spec reads.
        NODE_NO_WARNINGS: '1',
        ...(color === 'off' ? {NO_COLOR: '1'} : {FORCE_COLOR: '1'})
      }
    }
  )
}

afterAll(() => {
  for (const root of roots) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('a build with one warning, read without color (built CLI)', () => {
  it('opens the warning line with the glyph and the word', () => {
    expect(ensureCliBuilt()).toBe(true)

    const result = build(scaffold("console.log('bg')\n"), 'off')
    const lines = result.stdout.split('\n')
    const at = lines.findIndex((line) => line.includes(AMO_WARNING))

    expect(result.status).toBe(0)
    expect(lines[at]).toBe(`${GLYPH} Warning: ${AMO_WARNING}`)

    // The lines under it are the same block, so they take no word.
    expect(lines[at + 1]).toBe(
      "The extension's owner declares what the extension collects. The build proposes no value."
    )

    // The summary names the warning count itself, so it opens with the glyph alone.
    expect(lines[0]).toMatch(
      new RegExp(
        `^${GLYPH} \\[\\d\\d:\\d\\d:\\d\\d\\] Quote Keeper compiled with 1 warning in \\d+ ms, listed below\\.$`
      )
    )

    // Info and success lines keep the bare glyph.
    const built = lines.find((line) => line.includes('built for production'))
    expect(built).toMatch(new RegExp(`^${GLYPH} Add-on built`))
    expect(result.stdout).not.toMatch(/Warning: Warning|Error:/)
  }, 150_000)

  it('adds no word when the stream takes color', () => {
    expect(ensureCliBuilt()).toBe(true)

    const result = build(scaffold("console.log('bg')\n"), 'on')
    const line = result.stdout
      .split('\n')
      .find((candidate) => candidate.includes('addons.mozilla.org requires'))

    expect(result.status).toBe(0)
    expect(line).toMatch(/^\u001b\[93m⏵⏵⏵\u001b\[39m addons\.mozilla\.org/)
    expect(result.stdout).not.toContain('Warning:')
  }, 150_000)

  it('keeps the JSON frame as it was before the word', () => {
    expect(ensureCliBuilt()).toBe(true)

    const result = build(scaffold("console.log('bg')\n"), 'off', [
      '--output',
      'json'
    ])
    const frame = JSON.parse(result.stdout.trim().split('\n').pop() as string)

    expect(result.status).toBe(0)
    expect(frame.warnings).toEqual([WARNING_FRAME_TEXT])
    expect(frame.value.summaries[0].warnings).toEqual([WARNING_FRAME_TEXT])
    expect(result.stdout).not.toContain(GLYPH)

    // The human lines moved to stderr still say the word.
    expect(result.stderr).toContain(`${GLYPH} Warning: ${AMO_WARNING}`)
  }, 150_000)
})

describe('a build that fails, read without color (built CLI)', () => {
  const broken = "import {nope} from './missing-file.js'\nconsole.log(nope)\n"

  it('says Error: once on each error line', () => {
    expect(ensureCliBuilt()).toBe(true)

    const result = build(scaffold(broken), 'off')
    const lines = result.stderr.split('\n')

    expect(result.status).toBe(1)
    expect(result.stdout.split('\n')[0]).toMatch(
      new RegExp(
        `^${GLYPH} \\[\\d\\d:\\d\\d:\\d\\d\\] Quote Keeper failed to compile with 1 error and 1 warning in \\d+ ms\\.$`
      )
    )

    expect(lines.filter((line) => line.includes('Build error in'))).toEqual([
      expect.stringMatching(
        new RegExp(
          `^${GLYPH} Build error in \\./src/background\\.js 1:1-\\d+\\.$`
        )
      )
    ])

    expect(lines).toContain(`${GLYPH} Error: Build failed with 1 error.`)
    // The store hint is about the manifest, so a failed build keeps it.
    expect(result.stderr).toContain(`${GLYPH} Warning: ${AMO_WARNING}`)
    expect(result.stderr).not.toMatch(/Error: Build error|Error: Error/)
  }, 150_000)

  it('keeps the JSON failure frame as it was before the word', () => {
    expect(ensureCliBuilt()).toBe(true)

    const result = build(scaffold(broken), 'off', ['--output', 'json'])
    const frame = JSON.parse(result.stdout.trim().split('\n').pop() as string)

    expect(result.status).toBe(1)
    expect(frame.ok).toBe(false)
    expect(frame.error).toEqual({
      ...ERROR_FRAME,
      details: [
        ...ERROR_FRAME.details,
        {
          code: 'W_STORE_READINESS',
          file: 'manifest.json',
          message: WARNING_FRAME_TEXT.slice('W_STORE_READINESS: '.length),
          name: 'AmoDataCollectionWarning',
          severity: 'warning'
        }
      ]
    })

    expect(frame.warnings).toEqual([WARNING_FRAME_TEXT])
    expect(result.stdout).not.toContain(GLYPH)
  }, 150_000)
})
