import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {
  ADDON_LINT_DEFAULT,
  ADDON_LINT_MAX_PRINTED,
  ADDON_LINT_TIMEOUT_MS,
  type AddonLintOutput,
  attributionFor,
  collectAddonLintLines,
  formatAddonLintFindings,
  type LoadAddonLinter,
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
