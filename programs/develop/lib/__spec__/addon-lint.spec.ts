import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {
  ADDON_LINT_DEFAULT,
  ADDON_LINT_MAX_PRINTED,
  ADDON_LINT_PARSE_LIMIT_MB,
  ADDON_LINT_TIMEOUT_MS,
  type AddonLintOutput,
  attributionFor,
  buildNamesOversizeFiles,
  collectAddonLintLines,
  failedAddonLint,
  formatAddonLintFindings,
  type LoadAddonLinter,
  oversizeSingleFileLines,
  runAddonLint,
  shouldRunAddonLint,
  summarizeAddonLint
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

  it('names the key and both versions for a minimum version finding', () => {
    const finding = (code: string, product: string, key: string) => ({
      code,
      message: `Manifest key not supported by the specified minimum ${product} version`,
      description: `"strict_min_version" requires ${product} 109, which
        was released before version 154 introduced support for
        "${key}".`,
      file: 'manifest.json'
    })
    const {findings, lines} = formatAddonLintFindings(
      {
        errors: [],
        warnings: [
          finding('KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION', 'Firefox', 'sbx'),
          finding(
            'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION',
            'Firefox for Android',
            'sbx'
          ),
          finding(
            'KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION',
            'Firefox',
            'sbx.pages'
          )
        ]
      },
      'dist/firefox'
    )
    const plain = lines.map(stripAnsi)

    expect(findings).toBe(3)
    expect(plain[1]).toContain(
      'AMO warning KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION: "strict_min_version" requires Firefox 109, which was released before version 154 introduced support for "sbx". (manifest.json)'
    )

    expect(plain[2]).toContain(
      'requires Firefox for Android 109, which was released before version 154 introduced support for "sbx".'
    )

    expect(plain[3]).toContain('introduced support for "sbx.pages".')
    expect(plain.join('\n')).not.toContain('Manifest key not supported')
  })

  it('keeps the message of a finding that already names its subject', () => {
    const lines = collectAddonLintLines({
      errors: [],
      warnings: [
        {
          code: 'MANIFEST_PERMISSIONS',
          message: '/permissions: Invalid permissions "sidePanel" at 1.',
          description:
            'See https://mzl.la/1R1n1t0 (MDN Docs) for more information.',
          file: 'manifest.json'
        },
        {
          code: 'KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION',
          message:
            'Manifest key not supported by the specified minimum Firefox version',
          file: 'manifest.json'
        }
      ]
    })

    expect(lines.map((line) => line.message)).toEqual([
      '/permissions: Invalid permissions "sidePanel" at 1.',
      'Manifest key not supported by the specified minimum Firefox version'
    ])
  })

  it('prints the description when only it names the file', () => {
    const missing = (name: string) => ({
      code: 'MANIFEST_ICON_NOT_FOUND',
      message:
        'An icon defined in the manifest could not be found in the package.',
      description: `Icon could not be found at "icons/${name}.png".`,
      file: 'manifest.json'
    })
    const lines = collectAddonLintLines({
      errors: [
        {
          code: 'ICON_NOT_SQUARE',
          message: 'Icons must be square.',
          description: 'Icon at "icons/lopsided.png" must be square.',
          file: 'manifest.json'
        },
        missing('gone-light'),
        missing('gone-dark'),
        {
          code: 'NO_MESSAGES_FILE_IN_LOCALES',
          message: 'Empty language directory',
          description: 'messages.json file missing in "_locales/zz"',
          file: 'manifest.json'
        }
      ],
      warnings: [
        {
          code: 'ICON_SIZE_INVALID',
          message: 'The size of the icon does not match the manifest.',
          description: `
      Expected icon at "icons/roomy.png" to be 48 pixels wide but was 64.
    `,
          file: 'manifest.json'
        }
      ]
    })

    expect(lines.map((line) => line.message)).toEqual([
      'Icon at "icons/lopsided.png" must be square.',
      'Icon could not be found at "icons/gone-light.png".',
      'Icon could not be found at "icons/gone-dark.png".',
      'messages.json file missing in "_locales/zz"',
      'Expected icon at "icons/roomy.png" to be 48 pixels wide but was 64.'
    ])
  })

  it('keeps a message whose description only adds advice', () => {
    const kept = [
      {
        code: 'MISSING_ADDON_ID',
        message: 'The add-on ID is missing in the manifest.',
        description:
          'The "/browser_specific_settings/gecko/id" property (add-on ID) should be specified in the manifest. This property will become mandatory in the future. See https://mzl.la/3PLZYdo for more information.',
        file: 'manifest.json'
      },
      {
        code: 'JSON_BLOCK_COMMENTS',
        message: 'Your JSON contains block comments.',
        description:
          'Only line comments (comments beginning with "//") are allowed in JSON files. Please remove block comments (comments beginning with "/*")',
        file: 'data.json'
      },
      {
        code: 'NO_MESSAGE',
        message: 'Translation string is missing the message property',
        description:
          'No "message" message property is set for a string (https://mzl.la/2DSBTjA).',
        file: '_locales/en/messages.json'
      },
      {
        code: 'MANIFEST_UPDATE_URL',
        message: '"update_url" is not allowed.',
        description:
          '"applications.gecko.update_url" or "browser_specific_settings.gecko.update_url" are not allowed for Mozilla-hosted add-ons.',
        file: 'manifest.json'
      },
      {
        code: 'DANGEROUS_EVAL',
        message: 'eval can be harmful.',
        description:
          'Evaluation of strings as code can lead to security vulnerabilities and performance issues, even in the most innocuous of circumstances. Please avoid using `eval` and the `Function` constructor when possible.',
        file: 'background.js'
      }
    ]
    const lines = collectAddonLintLines({errors: [], warnings: kept})

    expect(lines.map((line) => line.message)).toEqual(
      kept.map((finding) => finding.message)
    )
  })

  it('prints a permission the minimum version lacks as a warning', () => {
    const notice = (code: string, product: string) => ({
      code,
      message: `Permission not supported by the specified minimum ${product} version`,
      description: `"strict_min_version" requires ${product} 112, which
        was released before version 139 introduced support for
        "permissions:tabHerd".`,
      file: 'manifest.json'
    })
    const {findings, lines} = formatAddonLintFindings(
      {
        errors: [],
        warnings: [],
        notices: [
          notice('PERMISSION_FIREFOX_UNSUPPORTED_BY_MIN_VERSION', 'Firefox'),
          notice(
            'PERMISSION_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION',
            'Firefox for Android'
          ),
          {
            code: 'KNOWN_LIBRARY',
            message: 'JavaScript library detected',
            file: 'vendor/tabHerd.js'
          }
        ]
      },
      'dist/firefox'
    )
    const plain = lines.map(stripAnsi)

    expect(findings).toBe(2)
    expect(plain[0]).toContain('addons-linter found 2 warnings')
    expect(plain[1]).toContain(
      'AMO warning PERMISSION_FIREFOX_UNSUPPORTED_BY_MIN_VERSION: "strict_min_version" requires Firefox 112, which was released before version 139 introduced support for "permissions:tabHerd". (manifest.json)'
    )

    expect(plain[2]).toContain(
      'AMO warning PERMISSION_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION: "strict_min_version" requires Firefox for Android 112,'
    )

    expect(plain.join('\n')).not.toContain('KNOWN_LIBRARY')
  })

  it('prints two findings that read the same as one line', () => {
    const twice = {
      code: 'KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION',
      message:
        'Manifest key not supported by the specified minimum Firefox version',
      description:
        '"strict_min_version" requires Firefox 109, which was released before version 154 introduced support for "sbx".',
      file: 'manifest.json'
    }
    const {findings, lines} = formatAddonLintFindings(
      {
        errors: [],
        warnings: [twice, {...twice}, {...twice, file: 'other.json'}]
      },
      'dist/firefox'
    )
    const plain = lines.map(stripAnsi)

    expect(findings).toBe(2)
    expect(plain).toHaveLength(3)
    expect(plain[0]).toContain('addons-linter found 2 warnings')
    expect(plain[1]).toContain('support for "sbx". (manifest.json)')
    expect(plain[2]).toContain('support for "sbx". (other.json)')
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

  // The linter names an oversize file itself, so the build only does it
  // when no linter line can exist, and only where the store check applies.
  it('has the build name oversize scripts when no linter line can exist', () => {
    const firefox = {browser: 'firefox', mode: 'production'} as const
    const off = {status: 'skipped', reason: 'disabled'} as const

    expect(buildNamesOversizeFiles(off, firefox)).toBe(true)
    expect(
      buildNamesOversizeFiles({status: 'missing', hint: null}, firefox)
    ).toBe(true)

    expect(
      buildNamesOversizeFiles(
        {status: 'failed', reason: 'boom', line: '', debugLine: ''},
        firefox
      )
    ).toBe(true)

    expect(
      buildNamesOversizeFiles(
        {status: 'linted', findings: 0, lines: [], reviewerNote: null},
        firefox
      )
    ).toBe(false)

    for (const browser of ['chrome', 'edge', 'safari', 'chromium']) {
      expect(buildNamesOversizeFiles(off, {browser, mode: 'production'})).toBe(
        false
      )
    }

    expect(
      buildNamesOversizeFiles(off, {browser: 'firefox', mode: 'development'})
    ).toBe(false)

    expect(
      buildNamesOversizeFiles({status: 'skipped', reason: 'browser'}, firefox)
    ).toBe(false)
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

describe('oversizeSingleFileLines', () => {
  it('names each single-file script at or past the limit and nothing else', () => {
    const root = project()
    const dist = path.join(root, 'dist', 'firefox')
    const limit = ADDON_LINT_PARSE_LIMIT_MB * 1024 * 1024
    const files: Array<[string, number]> = [
      ['background/scripts.js', limit],
      ['background/service_worker.js', limit - 1],
      ['content_scripts/content-0.js', limit + 300 * 1024],
      ['scripts/inject.js', limit + 1],
      // A page part, a shared chunk, a lazy chunk and data are not named:
      // the build caps the first three, and the last is not a script.
      ['action/index.js', limit + 1],
      ['shared/commons.js', limit + 1],
      ['367.js', limit + 1],
      ['content_scripts/data.json', limit + 1]
    ]

    for (const [file, bytes] of files) {
      fs.mkdirSync(path.dirname(path.join(dist, file)), {recursive: true})
      fs.writeFileSync(path.join(dist, file), Buffer.alloc(bytes, 0x61))
    }

    const lines = oversizeSingleFileLines(dist).map(stripAnsi)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain(
      'Firefox build: background/scripts.js is 5.0 MB - addons.mozilla.org does not parse a file of 5 MB or more, ' +
        'and Firefox loads a background script as one file, so the build cannot split it: ' +
        'load a large dependency with a dynamic import()'
    )

    expect(lines[1]).toContain(
      'content_scripts/content-0.js is 5.3 MB - addons.mozilla.org'
    )

    expect(lines[1]).toContain('Firefox loads a content script as one file')
    expect(lines[2]).toContain('scripts/inject.js is 5.0 MB')
    expect(lines[2]).toContain('Firefox loads an injected script as one file')

    // The text after the file and its size is the store check's own.
    expect(lines[0]).toContain(
      stripAnsi(
        attributionFor('background/scripts.js', undefined, 'FILE_TOO_LARGE')
      )
    )

    expect(oversizeSingleFileLines(path.join(root, 'nowhere'))).toEqual([])
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
    expect(hint).toContain('commands.build.addonLint: false')
    expect(hint).not.toContain('moved to')

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

  it('retires a reviewer note an earlier lint wrote when the linter is missing', async () => {
    const root = project()
    const dist = path.join(root, 'dist')
    fs.mkdirSync(dist, {recursive: true})
    fs.writeFileSync(path.join(dist, 'amo-reviewer-note.md'), 'old note\n')
    fs.writeFileSync(path.join(dist, 'amo-reviewer-note.stale.md'), 'older\n')

    const missing: LoadAddonLinter = async () => {
      throw new Error('[AMO] addons-linter could not be resolved.')
    }

    const result = await runAddonLint({...baseInput(root), loadLinter: missing})
    expect(result.status).toBe('missing')
    expect(fs.existsSync(path.join(dist, 'amo-reviewer-note.md'))).toBe(false)
    expect(
      fs.readFileSync(path.join(dist, 'amo-reviewer-note.stale.md'), 'utf8')
    ).toBe('old note\n')

    const hint = stripAnsi((result as {hint: string}).hint)
    expect(hint).toContain(
      `The reviewer note of the last lint moved to ${path.join('dist', 'amo-reviewer-note.stale.md')}`
    )

    // A second run with no note left says nothing about one.
    const again = await runAddonLint({
      ...baseInput(project()),
      loadLinter: missing
    })
    expect(stripAnsi((again as {hint: string}).hint)).not.toContain('moved to')
  })
})

describe('addon lint failure paths', () => {
  it('turns a linter crash into a plain line, a debug line and a reason', async () => {
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
    const failed = result as {reason: string; line: string; debugLine: string}
    expect(failed.reason).toBe('addons-linter crashed: boom')
    expect(stripAnsi(failed.line)).toContain(
      'Store check for addons.mozilla.org did not finish: addons-linter crashed: boom.'
    )

    expect(stripAnsi(failed.line)).toContain('npx addons-linter dist/firefox')
    expect(stripAnsi(failed.debugLine)).toContain(
      'addon-lint failed=true reason="addons-linter crashed: boom"'
    )

    expect(stripAnsi(failed.debugLine)).not.toContain('skipped')
  })

  async function expectUnusable(
    root: string,
    why: string,
    where: string,
    loadLinter?: LoadAddonLinter
  ) {
    const dist = path.join(root, 'dist')
    fs.mkdirSync(dist, {recursive: true})
    fs.writeFileSync(path.join(dist, 'amo-reviewer-note.md'), 'old note\n')

    const result = await runAddonLint({
      ...baseInput(root),
      ...(loadLinter ? {loadLinter} : {})
    })

    expect(result.status).toBe('failed')
    const failed = result as {reason: string; line: string; debugLine: string}
    expect(failed.reason).toBe(
      `addons-linter at ${where} is installed but cannot be used: ${why}`
    )

    expect(stripAnsi(failed.line)).toContain(
      `Store check for addons.mozilla.org did not finish: ${failed.reason}.`
    )

    expect(stripAnsi(failed.line)).not.toContain('not installed')
    expect(stripAnsi(failed.line)).not.toContain('Install it with')

    // npx would run the install that just failed, so it is never the advice.
    expect(stripAnsi(failed.line)).not.toContain('npx')
    expect(stripAnsi(failed.line)).toContain(
      'The build is complete. Reinstall the linter with pnpm add -D addons-linter and build again'
    )

    expect(stripAnsi(failed.line)).toContain(
      `The reviewer note of the last lint moved to ${path.join('dist', 'amo-reviewer-note.stale.md')}`
    )

    expect(summarizeAddonLint(result)).toEqual({
      status: 'failed',
      reason: failed.reason
    })

    // No lint ran, so the note of an earlier one does not describe this dist.
    expect(fs.existsSync(path.join(dist, 'amo-reviewer-note.md'))).toBe(false)
  }

  // A lint that started and did not end wrote no note, so the one on disk
  // belongs to an earlier build and is moved aside the same way.
  async function expectRetiredNote(root: string, loadLinter: LoadAddonLinter) {
    const dist = path.join(root, 'dist')
    fs.mkdirSync(dist, {recursive: true})
    fs.writeFileSync(path.join(dist, 'amo-reviewer-note.md'), 'old note\n')

    const result = await runAddonLint({
      ...baseInput(root),
      loadLinter,
      timeoutMs: 20
    })

    expect(result.status).toBe('failed')
    expect(fs.existsSync(path.join(dist, 'amo-reviewer-note.md'))).toBe(false)
    expect(
      fs.readFileSync(path.join(dist, 'amo-reviewer-note.stale.md'), 'utf8')
    ).toBe('old note\n')

    const line = stripAnsi((result as {line: string}).line)
    expect(line).toContain('npx addons-linter dist/firefox')
    expect(line).toContain(
      `The reviewer note of the last lint moved to ${path.join('dist', 'amo-reviewer-note.stale.md')}, since it does not describe this build.`
    )

    // With no note left, the next failure says nothing about one.
    const again = await runAddonLint({
      ...baseInput(root),
      loadLinter,
      timeoutMs: 20
    })
    expect(stripAnsi((again as {line: string}).line)).not.toContain('moved to')
    expect(
      fs.readFileSync(path.join(dist, 'amo-reviewer-note.stale.md'), 'utf8')
    ).toBe('old note\n')
  }

  it('retires the reviewer note of an earlier lint when the linter crashes', async () => {
    await expectRetiredNote(project(), async () => ({
      createInstance: () => ({
        run: async () => {
          throw new Error('boom')
        }
      })
    }))
  })

  it('retires the reviewer note of an earlier lint when the linter times out', async () => {
    await expectRetiredNote(project(), async () => ({
      createInstance: () => ({run: () => new Promise(() => {})})
    }))
  })

  it('leaves the note alone when the caller names no dist folder', () => {
    const root = project()
    const dist = path.join(root, 'dist')
    fs.mkdirSync(dist, {recursive: true})
    fs.writeFileSync(path.join(dist, 'amo-reviewer-note.md'), 'old note\n')

    const failed = failedAddonLint(new Error('boom'), 'dist/firefox')

    expect(stripAnsi(failed.line)).not.toContain('moved to')
    expect(fs.existsSync(path.join(dist, 'amo-reviewer-note.md'))).toBe(true)
  })

  // The real loader against a package that resolves from the project, since
  // what it throws is what tells a broken install from an absent one.
  it('reports an installed linter with no createInstance as unusable, with no install hint', async () => {
    const root = project()
    const packageDir = path.join(root, 'node_modules', 'addons-linter')

    fs.mkdirSync(packageDir, {recursive: true})
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'addons-linter',
        version: '0.0.0',
        main: 'index.js'
      })
    )

    fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {}\n')

    // Inside the project the copy is named the way the project names files.
    await expectUnusable(
      root,
      'addons-linter exports no createInstance',
      path.join('node_modules', 'addons-linter', 'index.js')
    )
  })

  it('names the load error of a linter that resolved and would not load', async () => {
    const outsideCopy = path.join(
      os.tmpdir(),
      'another-install',
      'node_modules',
      'addons-linter',
      'index.js'
    )

    const unloadable: LoadAddonLinter = async () => {
      throw Object.assign(
        new Error(
          '[AMO] addons-linter could not be loaded after it resolved. Install it with: pnpm add -D addons-linter'
        ),
        {
          code: 'E_OPTIONAL_DEP_LOAD',
          resolvedPath: outsideCopy,
          cause: new Error('linter entry boom\nRequire stack:\n- index.js')
        }
      )
    }

    // A copy outside the project keeps its full path.
    await expectUnusable(
      project(),
      'linter entry boom',
      outsideCopy,
      unloadable
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
    const failed = result as {reason: string; line: string}
    expect(failed.reason).toBe('addons-linter timed out after 0 s')
    expect(stripAnsi(failed.line)).toContain(
      'did not finish: addons-linter timed out after 0 s.'
    )
  })

  it('leaves the build a full minute before giving up', () => {
    expect(ADDON_LINT_TIMEOUT_MS).toBe(60_000)
  })
})

describe('addon lint summary', () => {
  it('records each outcome the way the build receipt spells it', async () => {
    const root = project()

    const missing: LoadAddonLinter = async () => {
      throw new Error('[AMO] addons-linter could not be resolved.')
    }

    const crashing: LoadAddonLinter = async () => ({
      createInstance: () => ({
        run: async () => {
          throw new Error('boom')
        }
      })
    })

    expect(
      summarizeAddonLint(
        await runAddonLint({
          ...baseInput(root),
          loadLinter: fakeLinter(FAKE_OUTPUT)
        })
      )
    ).toEqual({status: 'linted', findings: 2})

    expect(
      summarizeAddonLint(
        await runAddonLint({
          ...baseInput(root),
          loadLinter: fakeLinter({errors: [], warnings: []})
        })
      )
    ).toEqual({status: 'linted', findings: 0})

    expect(
      summarizeAddonLint(
        await runAddonLint({...baseInput(root), loadLinter: missing})
      )
    ).toEqual({status: 'missing'})

    expect(
      summarizeAddonLint(
        await runAddonLint({...baseInput(root), loadLinter: crashing})
      )
    ).toEqual({status: 'failed', reason: 'addons-linter crashed: boom'})

    expect(
      summarizeAddonLint(
        await runAddonLint({...baseInput(root), enabled: false})
      )
    ).toEqual({status: 'skipped', reason: 'disabled'})

    expect(
      summarizeAddonLint(
        await runAddonLint({...baseInput(root), browser: 'chrome'})
      )
    ).toEqual({status: 'skipped', reason: 'browser'})
  })
})

describe('dependency attribution', () => {
  const provenance = new Map([
    [
      'shared/framework.js',
      {packages: ['react', 'react-dom', 'scheduler'], onlyDependencies: true}
    ],
    [
      'content_scripts/content-0.js',
      {packages: ['react-dom'], onlyDependencies: false}
    ]
  ])

  it('says a vendor-only chunk is not the developer code', () => {
    expect(
      stripAnsi(attributionFor('shared/framework.js:1', provenance))
    ).toContain('bundled dependency code (react, react-dom, scheduler)')
  })

  it('hedges on a chunk that mixes the developer source in', () => {
    const line = stripAnsi(
      attributionFor('content_scripts/content-0.js:1', provenance)
    )
    expect(line).toContain('also bundles react-dom')
    expect(line).toContain('may be theirs')
  })

  it('matches a location a Windows linter run separates with backslashes', () => {
    expect(
      stripAnsi(attributionFor('shared\\framework.js:1', provenance))
    ).toContain('bundled dependency code')
  })

  it('says nothing about a file with no bundled dependency', () => {
    expect(attributionFor('background/scripts.js:1', provenance)).toBe('')
  })

  it('says nothing when the build passed no provenance', () => {
    expect(attributionFor('shared/framework.js:1', undefined)).toBe('')
  })

  it('annotates the printed finding without removing it', () => {
    const output: AddonLintOutput = {
      warnings: [
        {
          code: 'UNSAFE_VAR_ASSIGNMENT',
          message: 'Unsafe assignment to innerHTML',
          file: 'shared/framework.js',
          line: 1
        }
      ]
    }
    const {findings, lines} = formatAddonLintFindings(
      output,
      'dist/firefox',
      ADDON_LINT_MAX_PRINTED,
      provenance
    )

    expect(findings).toBe(1)
    const finding = stripAnsi(lines[1])
    expect(finding).toContain('UNSAFE_VAR_ASSIGNMENT')
    expect(finding).toContain('Unsafe assignment to innerHTML')
    expect(finding).toContain('shared/framework.js:1')
    expect(finding).toContain('bundled dependency code')
  })

  it('leaves a finding against the developer own code unchanged', () => {
    const output: AddonLintOutput = {
      warnings: [
        {
          code: 'UNSAFE_VAR_ASSIGNMENT',
          message: 'Unsafe assignment to innerHTML',
          file: 'background/scripts.js',
          line: 1
        }
      ]
    }
    const withMap = formatAddonLintFindings(
      output,
      'dist/firefox',
      ADDON_LINT_MAX_PRINTED,
      provenance
    )
    const withoutMap = formatAddonLintFindings(output, 'dist/firefox')

    expect(withMap.lines).toEqual(withoutMap.lines)
  })

  it('tells the author to guard an UNSUPPORTED_API finding instead of blaming the bundle', () => {
    const line = stripAnsi(
      attributionFor(
        'content_scripts/content-0.js:29',
        provenance,
        'UNSUPPORTED_API',
        'firefox'
      )
    )
    expect(line).not.toContain('may be theirs')
    expect(line).toContain('your code, not a library')
    expect(line).toContain(
      'process.env.EXTENSION_PUBLIC_BROWSER (return early when it reads "firefox")'
    )

    expect(line).not.toContain('=== "chrome"')
  })

  it('says the guard for an UNSUPPORTED_API finding even without provenance', () => {
    const output: AddonLintOutput = {
      warnings: [
        {
          code: 'UNSUPPORTED_API',
          message: 'offscreen.createDocument is not supported',
          file: 'background/scripts.js',
          line: 29
        }
      ]
    }
    const {lines} = formatAddonLintFindings(output, 'dist/firefox')
    const finding = stripAnsi(lines[1])
    expect(finding).toContain(
      'AMO warning UNSUPPORTED_API: offscreen.createDocument is not supported (background/scripts.js:29)'
    )

    expect(finding).toContain('return early when it reads "firefox"')
  })

  it('names the file, the limit and the way out for a single-file surface over the limit', () => {
    const output: AddonLintOutput = {
      errors: [
        {
          code: 'FILE_TOO_LARGE',
          message: 'File is too large to parse.',
          description:
            'This file is not binary and is too large to parse. Files larger than 5MB will not be parsed.',
          file: 'background/service_worker.js'
        }
      ]
    }
    const {lines} = formatAddonLintFindings(
      output,
      'dist/firefox',
      ADDON_LINT_MAX_PRINTED,
      new Map([
        [
          'background/service_worker.js',
          {packages: ['openai'], onlyDependencies: false}
        ]
      ])
    )
    const finding = stripAnsi(lines[1])
    expect(finding).toContain(
      'AMO error FILE_TOO_LARGE: File is too large to parse. (background/service_worker.js)'
    )

    expect(finding).toContain('does not parse a file of 5 MB or more')
    expect(finding).toContain('Firefox loads a background script as one file')
    expect(finding).toContain('dynamic import()')
    expect(finding).not.toContain('may be theirs')

    for (const [file, surface] of [
      ['content_scripts/content-0.js', 'a content script'],
      ['scripts/inject.js', 'an injected script'],
      ['user_scripts/api_script.js', 'an injected script']
    ]) {
      expect(
        stripAnsi(attributionFor(file, undefined, 'FILE_TOO_LARGE'))
      ).toContain(`Firefox loads ${surface} as one file`)
    }
  })

  it('does not call a page part, a shared chunk or a data file a single-file surface', () => {
    for (const file of [
      'action/index-2.js',
      'background/index.js',
      'shared/commons-0.js',
      'data/words.json',
      'scripts/table.json'
    ]) {
      const line = stripAnsi(attributionFor(file, undefined, 'FILE_TOO_LARGE'))
      expect(line).toContain('does not parse a file of 5 MB or more')
      expect(line).toContain('into parts under the limit')
      expect(line).not.toContain('as one file')
    }
  })

  it('keeps the hedge for an eval finding in a file that bundles dependencies', () => {
    const line = stripAnsi(
      attributionFor(
        'content_scripts/content-0.js:1',
        provenance,
        'DANGEROUS_EVAL',
        'firefox'
      )
    )
    expect(line).toContain('may be theirs')
    expect(line).not.toContain('EXTENSION_PUBLIC_BROWSER')
  })

  it('writes the notes to reviewer beside the browser folder and says where', async () => {
    const root = project()
    const output: AddonLintOutput = {
      warnings: [
        {
          code: 'UNSAFE_VAR_ASSIGNMENT',
          message: 'Unsafe assignment to innerHTML',
          file: 'shared/framework.js',
          line: 1
        },
        {
          code: 'UNSUPPORTED_API',
          message: 'offscreen.createDocument is not supported',
          file: 'background/scripts.js',
          line: 29
        }
      ]
    }
    const result = await runAddonLint({
      ...baseInput(root),
      loadLinter: fakeLinter(output),
      chunkProvenance: () => provenance
    })

    expect(result.status).toBe('linted')
    if (result.status !== 'linted') return

    expect(result.reviewerNote?.path).toBe(
      path.join(root, 'dist', 'amo-reviewer-note.md')
    )

    expect(stripAnsi(result.reviewerNote?.line || '')).toContain(
      `Notes to reviewer for addons.mozilla.org are at ${path.join('dist', 'amo-reviewer-note.md')}`
    )

    const note = fs.readFileSync(result.reviewerNote?.path as string, 'utf8')
    expect(note).toContain('### react')
    expect(note).toContain('unmodified from npm')
    expect(note).toContain(
      '## Findings in the extension author code\n\nThese are not library noise and must not be presented as such.\n\n- UNSUPPORTED_API: offscreen.createDocument is not supported (background/scripts.js:29)'
    )

    // The printed lines are the same as before, apart from the note line.
    expect(result.lines.map(stripAnsi)).toEqual(
      formatAddonLintFindings(
        output,
        'dist/firefox',
        ADDON_LINT_MAX_PRINTED,
        provenance
      ).lines.map(stripAnsi)
    )
  })

  it('never walks the chunk graph when the lint is skipped', async () => {
    const root = project()
    let walked = 0

    const chunkProvenance = () => {
      walked += 1

      return new Map()
    }

    await runAddonLint({...baseInput(root), browser: 'chrome', chunkProvenance})
    await runAddonLint({
      ...baseInput(root),
      mode: 'development',
      chunkProvenance
    })

    await runAddonLint({...baseInput(root), enabled: false, chunkProvenance})

    expect(walked).toBe(0)
  })
})
