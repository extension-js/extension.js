import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {
  ADDON_LINT_DEFAULT,
  ADDON_LINT_MAX_PRINTED,
  type AddonLintOutput,
  collectAddonLintLines,
  formatAddonLintFindings,
  type LoadAddonLinter,
  runAddonLint,
  shouldRunAddonLint
} from '../addon-lint'

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, '')
}

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// A throwaway project with a pnpm lockfile so the install hint is stable.
function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-addon-lint-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'lint-me', version: '0.0.0', private: true})
  )

  fs.writeFileSync(
    path.join(root, 'pnpm-lock.yaml'),
    "lockfileVersion: '9.0'\n"
  )

  return root
}

const FAKE_OUTPUT: AddonLintOutput = {
  errors: [
    {
      code: 'ADDON_ID_REQUIRED',
      message: 'The add-on ID is required in Manifest Version 3 and above.',
      file: 'manifest.json'
    }
  ],
  warnings: [
    {
      code: 'DANGEROUS_EVAL',
      message: 'eval can be harmful.',
      file: 'background.js',
      line: 1,
      column: 1
    },
    {
      code: 'MISSING_DATA_COLLECTION_PERMISSIONS',
      message: 'The "data_collection_permissions" property is missing.',
      file: 'manifest.json'
    }
  ],
  notices: [{code: 'KNOWN_LIBRARY', message: 'ignored'}]
}

function fakeLinter(
  output: AddonLintOutput,
  onRun?: () => void
): LoadAddonLinter {
  return async () => ({
    createInstance: () => ({
      run: async () => {
        onRun?.()

        return output
      }
    })
  })
}

function baseInput(root: string) {
  return {
    projectPath: root,
    distPath: path.join(root, 'dist', 'firefox'),
    distDisplay: 'dist/firefox',
    browser: 'firefox',
    mode: 'production' as const
  }
}

describe('addon lint mapping', () => {
  it('lists errors before warnings, drops notices and the duplicated data-collection code', () => {
    const lines = collectAddonLintLines(FAKE_OUTPUT)
    expect(lines.map((line) => `${line.level}:${line.code}`)).toEqual([
      'error:ADDON_ID_REQUIRED',
      'warning:DANGEROUS_EVAL'
    ])

    expect(lines[1].location).toBe('background.js:1')
    expect(lines[0].location).toBe('manifest.json')
  })

  it('prints one line per finding under a summary line', () => {
    const {findings, lines} = formatAddonLintFindings(
      FAKE_OUTPUT,
      'dist/firefox'
    )
    const plain = lines.map(stripAnsi)
    expect(findings).toBe(2)
    expect(plain).toHaveLength(3)
    expect(plain[0]).toContain(
      'addons-linter found 1 error and 1 warning in dist/firefox'
    )

    expect(plain[1]).toContain(
      'AMO error ADDON_ID_REQUIRED: The add-on ID is required in Manifest Version 3 and above. (manifest.json)'
    )

    expect(plain[2]).toContain(
      'AMO warning DANGEROUS_EVAL: eval can be harmful. (background.js:1)'
    )
  })

  it('caps the printed findings and says how many more there are', () => {
    const warnings = Array.from(
      {length: ADDON_LINT_MAX_PRINTED + 7},
      (_, i) => ({
        code: `RULE_${i}`,
        message: `finding ${i}`,
        file: `file-${i}.js`
      })
    )
    const {findings, lines} = formatAddonLintFindings(
      {errors: [], warnings},
      'dist/firefox'
    )
    const plain = lines.map(stripAnsi)
    expect(findings).toBe(ADDON_LINT_MAX_PRINTED + 7)
    // summary + capped findings + the "more" line
    expect(plain).toHaveLength(ADDON_LINT_MAX_PRINTED + 2)
    expect(plain[plain.length - 1]).toContain('7 more findings not shown')
    expect(plain[plain.length - 1]).toContain('npx addons-linter dist/firefox')
  })

  it('reports nothing for a clean result', () => {
    expect(formatAddonLintFindings({errors: [], warnings: []}, 'x')).toEqual({
      findings: 0,
      lines: []
    })

    expect(formatAddonLintFindings(null, 'x').lines).toEqual([])
  })
})

describe('addon lint gating', () => {
  it('is on by default', () => {
    expect(ADDON_LINT_DEFAULT).toBe(true)
    expect(shouldRunAddonLint({browser: 'firefox', mode: 'production'})).toBe(
      null
    )
  })

  it('skips development builds and chromium targets without loading the linter', async () => {
    const root = project()
    const load = vi.fn(fakeLinter(FAKE_OUTPUT))

    await expect(
      runAddonLint({...baseInput(root), mode: 'development', loadLinter: load})
    ).resolves.toEqual({status: 'skipped', reason: 'mode'})

    await expect(
      runAddonLint({...baseInput(root), browser: 'chrome', loadLinter: load})
    ).resolves.toEqual({status: 'skipped', reason: 'browser'})

    await expect(
      runAddonLint({
        ...baseInput(root),
        browser: 'chromium-based',
        loadLinter: load
      })
    ).resolves.toEqual({status: 'skipped', reason: 'browser'})

    await expect(
      runAddonLint({...baseInput(root), enabled: false, loadLinter: load})
    ).resolves.toEqual({status: 'skipped', reason: 'disabled'})

    expect(load).not.toHaveBeenCalled()
  })

  it('runs for every gecko family spelling', async () => {
    const root = project()

    for (const browser of ['firefox', 'gecko-based', 'firefox-based']) {
      const result = await runAddonLint({
        ...baseInput(root),
        browser,
        loadLinter: fakeLinter(FAKE_OUTPUT)
      })
      expect(result.status).toBe('linted')
    }
  })
})

describe('addon lint when the linter is not installed', () => {
  it('prints one package-manager-aware hint per project and continues', async () => {
    const root = project()

    const missing: LoadAddonLinter = async () => {
      throw new Error('[AMO] addons-linter could not be resolved.')
    }

    const first = await runAddonLint({...baseInput(root), loadLinter: missing})
    expect(first.status).toBe('missing')
    const hint = stripAnsi((first as {hint: string}).hint)
    expect(hint).toContain(
      'Skipped the addons.mozilla.org lint: addons-linter is not installed.'
    )

    expect(hint).toContain('Install it with: pnpm add -D addons-linter')
    expect(hint).toContain('--no-addon-lint')

    const second = await runAddonLint({...baseInput(root), loadLinter: missing})
    expect(second).toEqual({status: 'missing', hint: null})

    // Another project gets its own hint.
    const other = await runAddonLint({
      ...baseInput(project()),
      loadLinter: missing
    })
    expect(other.status).toBe('missing')
    expect((other as {hint: string | null}).hint).not.toBeNull()
  })
})

describe('addon lint failure paths', () => {
  it('turns a linter crash into a single debug line', async () => {
    const root = project()
    const crashing: LoadAddonLinter = async () => ({
      createInstance: () => ({
        run: async () => {
          throw new Error('boom')
        }
      })
    })
    const result = await runAddonLint({
      ...baseInput(root),
      loadLinter: crashing
    })
    expect(result.status).toBe('failed')
    expect(stripAnsi((result as {debugLine: string}).debugLine)).toContain(
      'addon-lint skipped=true reason="boom"'
    )
  })

  it('gives up after the time box instead of hanging the build', async () => {
    const root = project()
    const slow: LoadAddonLinter = async () => ({
      createInstance: () => ({
        run: () => new Promise(() => {})
      })
    })
    const result = await runAddonLint({
      ...baseInput(root),
      loadLinter: slow,
      timeoutMs: 20
    })
    expect(result.status).toBe('failed')
    expect((result as {debugLine: string}).debugLine).toContain('timed out')
  })
})
