import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {everyLineAsFrame, runCli, startCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'
import {normalizeFrame, normalizeTranscript} from '../helpers/transcript'

interface Diagnostic {
  code?: string
  message: string
  file?: string
  line?: number
  column?: number
  severity: string
  name?: string
}

interface Frame {
  ok: boolean
  command: string
  status: string
  value: {output?: string} | null
  error: {code: string; message: string; details?: Diagnostic[]} | null
  truncated?: boolean
  warnings: string[]
}

const env = {EXTENSION_DEBUG: '0'}

function parseFrames(stdout: string): Frame[] {
  return everyLineAsFrame<Frame>(stdout)
}

function createFixture(): string {
  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-json-diagnostics-'))
  mkdirSync(join(projectDir, 'content'), {recursive: true})
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({name: 'json-diagnostics', private: true, version: '1.0.0'})
  )

  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'JSON Diagnostics',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    })
  )

  writeFileSync(
    join(projectDir, 'background.js'),
    "import './missing-dep-token'\nconsole.log('json-diagnostics')\n"
  )

  writeFileSync(
    join(projectDir, 'content', 'scripts.js'),
    'const brokenToken = ;\n'
  )

  return projectDir
}

function expectCodedDetails(
  details: Diagnostic[] | undefined,
  line: number | ReturnType<typeof expect.any> = 1
) {
  expect(details).toHaveLength(2)

  const notFound = details?.find((d) => d.code === 'E_MODULE_NOT_FOUND')
  expect(notFound).toMatchObject({
    file: 'background.js',
    line,
    column: 1,
    severity: 'error'
  })

  expect(notFound?.message).toContain("Can't resolve './missing-dep-token'")

  const syntax = details?.find((d) => d.code === 'E_CONTENT_SCRIPT_SYNTAX')
  expect(syntax).toMatchObject({
    file: 'content/scripts.js',
    severity: 'error',
    name: 'ModuleBuildError'
  })

  expect(syntax?.message).toContain('const brokenToken = ;')
}

describe('a failed compile under --output json lists each diagnostic with its code', () => {
  let projectDir = ''

  beforeAll(() => {
    projectDir = createFixture()
  })

  afterAll(() => {
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('build ends with one build-failed frame whose error carries details', async () => {
    const run = await runCli(
      ['build', '.', '--browser=chromium', '--output', 'json'],
      {cwd: projectDir, env}
    )

    expect(run.status).toBe(1)

    const frames = parseFrames(run.stdout)
    expect(frames).toHaveLength(1)

    const [frame] = frames
    expect(frame.ok).toBe(false)
    expect(frame.status).toBe('build-failed')
    expect(frame.error?.code).toBe('E_COMPILE')
    expect(frame.truncated).toBeUndefined()
    expectCodedDetails(frame.error?.details)
  }, 180_000)

  it.skipIf(process.platform === 'win32')(
    'dev --no-browser emits a compile-failed frame whose error carries details',
    async () => {
      const session = startCli(
        [
          'dev',
          projectDir,
          '--browser',
          'chrome',
          '--no-browser',
          '--output',
          'json'
        ],
        {env}
      )
      const failed = () =>
        session
          .frames<Frame>()
          .find((candidate) => candidate.status === 'compile-failed')

      try {
        await session.waitFor(
          () => failed() !== undefined,
          90_000,
          'the compile-failed frame'
        )
      } finally {
        await session.stop('SIGTERM', 15_000)
      }

      const {stdout, stderr} = session.read()
      const frame = parseFrames(stdout).find(
        (candidate) => candidate.status === 'compile-failed'
      )
      expect(frame, stderr).toBeDefined()
      expect(frame?.ok).toBe(false)
      expect(frame?.error?.code).toBe('E_FIRST_COMPILE')
      expect(frame?.value?.output).toContain('missing-dep-token')
      expectCodedDetails(frame?.error?.details, expect.any(Number))
    },
    180_000
  )
})

const makeTempFolder = trackTempFolders()

// Fixture files per row: a string is written as is, an object as JSON, and
// null makes a folder.
interface DiagnosticRow {
  code: string
  label: string
  files: Record<string, string | object | null>
  args: string[]
  expected: {status: number; frames: unknown[]; stderr: string}
}

const mv3 = (extra: object = {}) => ({
  manifest_version: 3,
  name: 'Diagnostic',
  version: '1.0.0',
  ...extra
})

const DIAGNOSTIC_ROWS: DiagnosticRow[] = [
  {
    code: 'E_ENTRY_NOT_FOUND',
    label: 'a background service worker that is not there',
    files: {'manifest.json': mv3({background: {service_worker: 'missing.js'}})},
    args: [],
    expected: {
      status: 1,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'build',
          status: 'build-failed',
          value: null,
          error: {
            code: 'E_COMPILE',
            message: 'Build failed with errors',
            details: [
              {
                code: 'E_ENTRY_NOT_FOUND',
                message:
                  'missing.js does not exist. Check the background.service_worker field in your manifest.json file.\nThe path must point to an existing file that will be bundled.\nNOT FOUND <project>/missing.js',
                file: 'manifest.json',
                severity: 'error',
                name: 'ScriptsMissingFile'
              }
            ]
          },
          warnings: [],
          hint: 'Fix the error above and run build again.'
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] Diagnostic compiled with errors in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      Diagnostic 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '⏵⏵⏵ Build error in manifest.json.',
        '    × missing.js does not exist. Check the background.service_worker field in your manifest.json file.',
        '    │ The path must point to an existing file that will be bundled.',
        '    │ NOT FOUND <project>/missing.js',
        '',
        '⏵⏵⏵ Build failed with 1 error.',
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_WAR_INVALID',
    label: 'a plain string in web_accessible_resources under MV3',
    files: {'manifest.json': mv3({web_accessible_resources: ['a.js']})},
    args: [],
    expected: {
      status: 1,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'build',
          status: 'build-failed',
          value: null,
          error: {
            code: 'E_COMPILE',
            message: 'Build failed with errors',
            details: [
              {
                code: 'E_WAR_INVALID',
                message:
                  'Chrome rejects plain string entries in web_accessible_resources under Manifest V3.\nGOT a.js\nPlain string entries are the Manifest V2 format.\nManifest V3 requires object entries with resources and matches (or extension_ids).\nWrap it like {"resources": ["a.js"], "matches": ["<all_urls>"]} with the matches your pages need.',
                file: 'manifest.json',
                severity: 'error',
                name: 'WARStringEntryInMv3'
              }
            ]
          },
          warnings: [],
          hint: 'Fix the error above and run build again.'
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] Diagnostic compiled with errors in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      Diagnostic 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '⏵⏵⏵ Build error in manifest.json.',
        '    × Chrome rejects plain string entries in web_accessible_resources under Manifest V3.',
        '    │ GOT a.js',
        '    │ Plain string entries are the Manifest V2 format.',
        '    │ Manifest V3 requires object entries with resources and matches (or extension_ids).',
        '    │ Wrap it like {"resources": ["a.js"], "matches": ["<all_urls>"]} with the matches your pages need.',
        '',
        '⏵⏵⏵ Build failed with 1 error.',
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_THEME_INVALID',
    label: 'a theme color with an alpha and a tint written as hex',
    files: {
      'manifest.json': mv3({
        theme: {
          colors: {frame: '#1b263bcc', toolbar: '#000'},
          tints: {buttons: '#fff'}
        }
      })
    },
    args: [],
    expected: {
      status: 1,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'build',
          status: 'build-failed',
          value: null,
          error: {
            code: 'E_COMPILE',
            message: 'Build failed with errors',
            details: [
              {
                code: 'E_THEME_INVALID',
                message:
                  'chromium loads theme.colors and theme.tints only as number arrays, and the build cannot translate these values from your manifest.json exactly:\n  theme.colors.frame "#1b263bcc", write [27, 38, 59, 0.8]\n  theme.tints.buttons "#fff", write [H, S, L]\nA color is [R, G, B] with whole numbers from 0 to 255, plus an optional alpha from 0 to 1 as a fourth member. A tint is three numbers, [H, S, L].\nThe browser refuses the whole extension over one such value, so the build stops here.',
                file: 'manifest.json',
                severity: 'error',
                name: 'ThemeArrayInvalid'
              }
            ]
          },
          warnings: [],
          hint: 'Fix the error above and run build again.'
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] Diagnostic compiled with errors in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      Diagnostic 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '⏵⏵⏵ Build error in manifest.json.',
        '    × chromium loads theme.colors and theme.tints only as number arrays, and the build cannot translate these values from your manifest.json exactly:',
        '    │   theme.colors.frame "#1b263bcc", write [27, 38, 59, 0.8]',
        '    │   theme.tints.buttons "#fff", write [H, S, L]',
        '    │ A color is [R, G, B] with whole numbers from 0 to 255, plus an optional alpha from 0 to 1 as a fourth member. A tint is three numbers, [H, S, L].',
        '    │ The browser refuses the whole extension over one such value, so the build stops here.',
        '',
        '⏵⏵⏵ Build failed with 1 error.',
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_CSS_PARSE',
    label: 'a content script stylesheet that does not parse',
    files: {
      'manifest.json': mv3({
        content_scripts: [{matches: ['<all_urls>'], css: ['a.css']}]
      }),
      'a.css': 'a { color: red'
    },
    args: [],
    expected: {
      status: 0,
      frames: [
        {
          schema: 1,
          ok: true,
          command: 'build',
          status: 'built',
          value: {
            projectPath: '.',
            browsers: ['chromium'],
            mode: 'production',
            summaries: [
              {
                browser: 'chromium',
                buildType: 'production',
                output_path: '<project>/dist/chromium',
                total_assets: 3,
                total_bytes: 0,
                largest_asset_bytes: 0,
                warnings_count: 1,
                errors_count: 0,
                warnings: [
                  "E_CSS_PARSE: ⏵⏵⏵ The CSS in this file doesn't parse, so it was copied as-is.\n  │ PATH a.css\n  │ REASON Unclosed block\n  │ Browsers skip rules they can't parse, so the build kept going.\n  │ PostCSS and Tailwind processing wasn't applied to this file.\n  │ Fix the CSS to re-enable processing."
                ],
                toolchain: {
                  node: '<node>',
                  extension_js: '<version>'
                },
                addon_lint: {
                  status: 'skipped',
                  reason: 'browser'
                }
              }
            ]
          },
          error: null,
          warnings: [
            "E_CSS_PARSE: ⏵⏵⏵ The CSS in this file doesn't parse, so it was copied as-is.\n  │ PATH a.css\n  │ REASON Unclosed block\n  │ Browsers skip rules they can't parse, so the build kept going.\n  │ PostCSS and Tailwind processing wasn't applied to this file.\n  │ Fix the CSS to re-enable processing."
          ]
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] Diagnostic compiled with warnings in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      Diagnostic 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '.',
        '├─ manifest.json (N KB)',
        '└─ content_scripts',
        '   ├─ content-0.js (N KB)',
        '   └─ content-0.css (N KB)',
        '',
        "⏵⏵⏵ The CSS in this file doesn't parse, so it was copied as-is.",
        'PATH a.css',
        'REASON Unclosed block',
        "Browsers skip rules they can't parse, so the build kept going.",
        "PostCSS and Tailwind processing wasn't applied to this file.",
        'Fix the CSS to re-enable processing.',
        '⏵⏵⏵ Extension built for production in dist/chromium (N B).',
        "⏵⏵⏵ Built with Node <node> and Extension.js <version>. Name these versions in the store's reviewer note so a reviewer can rebuild it and match these bytes.",
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_CSS_DEAD_REF',
    label: 'a stylesheet url() to a file that exists nowhere',
    files: {
      'manifest.json': mv3({
        content_scripts: [{matches: ['<all_urls>'], css: ['a.css']}]
      }),
      'a.css': 'a { background: url(./nope.png) }'
    },
    args: [],
    expected: {
      status: 0,
      frames: [
        {
          schema: 1,
          ok: true,
          command: 'build',
          status: 'built',
          value: {
            projectPath: '.',
            browsers: ['chromium'],
            mode: 'production',
            summaries: [
              {
                browser: 'chromium',
                buildType: 'production',
                output_path: '<project>/dist/chromium',
                total_assets: 3,
                total_bytes: 0,
                largest_asset_bytes: 0,
                warnings_count: 1,
                errors_count: 0,
                warnings: [
                  "E_CSS_DEAD_REF: A url(./nope.png) reference points to a file that exists nowhere in the project.\n  │ PATH a.css\n  │ NOT FOUND ./nope.png\n  │ Chrome applies the rest of the stylesheet and 404s this reference silently, so it's likely dead code.\n  │ Set EXTENSION_STRICT_REFS=true to make this a build error."
                ],
                toolchain: {
                  node: '<node>',
                  extension_js: '<version>'
                },
                addon_lint: {
                  status: 'skipped',
                  reason: 'browser'
                }
              }
            ]
          },
          error: null,
          warnings: [
            "E_CSS_DEAD_REF: A url(./nope.png) reference points to a file that exists nowhere in the project.\n  │ PATH a.css\n  │ NOT FOUND ./nope.png\n  │ Chrome applies the rest of the stylesheet and 404s this reference silently, so it's likely dead code.\n  │ Set EXTENSION_STRICT_REFS=true to make this a build error."
          ]
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] Diagnostic compiled with warnings in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      Diagnostic 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '.',
        '├─ manifest.json (N KB)',
        '└─ content_scripts',
        '   ├─ content-0.js (N KB)',
        '   └─ content-0.css (N KB)',
        '',
        '⏵⏵⏵ Warning: A url(./nope.png) reference points to a file that exists nowhere in the project. (a.css)',
        'PATH a.css',
        'NOT FOUND ./nope.png',
        "Chrome applies the rest of the stylesheet and 404s this reference silently, so it's likely dead code.",
        'Set EXTENSION_STRICT_REFS=true to make this a build error.',
        '│  Source: bundler',
        '⏵⏵⏵ Extension built for production in dist/chromium (N B).',
        "⏵⏵⏵ Built with Node <node> and Extension.js <version>. Name these versions in the store's reviewer note so a reviewer can rebuild it and match these bytes.",
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_PROD_LOOPBACK_ORIGIN',
    label: 'a production manifest that reaches localhost',
    files: {'manifest.json': mv3({host_permissions: ['http://localhost/*']})},
    args: [],
    expected: {
      status: 0,
      frames: [
        {
          schema: 1,
          ok: true,
          command: 'build',
          status: 'built',
          value: {
            projectPath: '.',
            browsers: ['chromium'],
            mode: 'production',
            summaries: [
              {
                browser: 'chromium',
                buildType: 'production',
                output_path: '<project>/dist/chromium',
                total_assets: 1,
                total_bytes: 0,
                largest_asset_bytes: 0,
                warnings_count: 1,
                errors_count: 0,
                toolchain: {
                  node: '<node>',
                  extension_js: '<version>'
                },
                warnings: [
                  'E_PROD_LOOPBACK_ORIGIN: the production manifest reaches the local machine (http://localhost/* in host_permissions). Keep loopback origins to development with an $EXTENSION_PUBLIC_* placeholder and a .env.development value.'
                ],
                addon_lint: {
                  status: 'skipped',
                  reason: 'browser'
                }
              }
            ]
          },
          error: null,
          warnings: [
            'E_PROD_LOOPBACK_ORIGIN: the production manifest reaches the local machine (http://localhost/* in host_permissions). Keep loopback origins to development with an $EXTENSION_PUBLIC_* placeholder and a .env.development value.'
          ]
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] Diagnostic compiled in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      Diagnostic 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '.',
        '└─ manifest.json (N KB)',
        '',
        '⏵⏵⏵ The production manifest reaches the local machine:',
        '  http://localhost/* in host_permissions',
        'Store reviewers read a loopback origin as host access with no purpose in a published extension. Keep it to development with an $EXTENSION_PUBLIC_* placeholder in the manifest and its value in .env.development.',
        '⏵⏵⏵ Extension built for production in dist/chromium (N B).',
        "⏵⏵⏵ Built with Node <node> and Extension.js <version>. Name these versions in the store's reviewer note so a reviewer can rebuild it and match these bytes.",
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_REMOTE_RESOURCE_BLOCKED',
    label: 'a page that loads a remote script',
    files: {
      'manifest.json': mv3({action: {default_popup: 'popup.html'}}),
      // A dead loopback port: the build reads the tag and never fetches it.
      'popup.html':
        '<html><head><script src="http://127.0.0.1:9/x.js"></script></head><body></body></html>'
    },
    args: [],
    expected: {
      status: 0,
      frames: [
        {
          schema: 1,
          ok: true,
          command: 'build',
          status: 'built',
          value: {
            projectPath: '.',
            browsers: ['chromium'],
            mode: 'production',
            summaries: [
              {
                browser: 'chromium',
                buildType: 'production',
                output_path: '<project>/dist/chromium',
                total_assets: 2,
                total_bytes: 0,
                largest_asset_bytes: 0,
                warnings_count: 1,
                errors_count: 0,
                warnings: [
                  'E_REMOTE_RESOURCE_BLOCKED: The page loads a remote <script>, which the MV3 CSP blocks.\n  │ PATH <project>/popup.html\n  │ GOT http://127.0.0.1:9/x.js\n  │ Bundle the script or self-host it instead.'
                ],
                toolchain: {
                  node: '<node>',
                  extension_js: '<version>'
                },
                addon_lint: {
                  status: 'skipped',
                  reason: 'browser'
                }
              }
            ]
          },
          error: null,
          warnings: [
            'E_REMOTE_RESOURCE_BLOCKED: The page loads a remote <script>, which the MV3 CSP blocks.\n  │ PATH <project>/popup.html\n  │ GOT http://127.0.0.1:9/x.js\n  │ Bundle the script or self-host it instead.'
          ]
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] Diagnostic compiled with warnings in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      Diagnostic 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '.',
        '├─ manifest.json (N KB)',
        '└─ action',
        '   └─ index.html (N KB)',
        '',
        '⏵⏵⏵ Warning: The page loads a remote <script>, which the MV3 CSP blocks. (popup.html)',
        'PATH <project>/popup.html',
        'GOT http://127.0.0.1:9/x.js',
        'Bundle the script or self-host it instead.',
        '│  Source: bundler',
        '⏵⏵⏵ Extension built for production in dist/chromium (N B).',
        "⏵⏵⏵ Built with Node <node> and Extension.js <version>. Name these versions in the store's reviewer note so a reviewer can rebuild it and match these bytes.",
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_LOCALES_LAYOUT',
    label: 'a locale folder with no messages.json',
    files: {
      'manifest.json': mv3({default_locale: 'en', name: '__MSG_n__'}),
      '_locales/en/messages.json': {n: {message: 'Diagnostic'}},
      '_locales/fr': null
    },
    args: [],
    expected: {
      status: 0,
      frames: [
        {
          schema: 1,
          ok: true,
          command: 'build',
          status: 'built',
          value: {
            projectPath: '.',
            browsers: ['chromium'],
            mode: 'production',
            summaries: [
              {
                browser: 'chromium',
                buildType: 'production',
                output_path: '<project>/dist/chromium',
                total_assets: 2,
                total_bytes: 0,
                largest_asset_bytes: 0,
                warnings_count: 1,
                errors_count: 0,
                warnings: [
                  'E_LOCALES_LAYOUT: A locale folder has no messages.json file, so the build left it out.\n  │ FOLDER _locales/fr\n  │ Stores reject a locale folder that has no messages.json file.\n  │ Add a messages.json file to ship the folder, or delete the folder to silence this warning.'
                ],
                toolchain: {
                  node: '<node>',
                  extension_js: '<version>'
                },
                addon_lint: {
                  status: 'skipped',
                  reason: 'browser'
                }
              }
            ]
          },
          error: null,
          warnings: [
            'E_LOCALES_LAYOUT: A locale folder has no messages.json file, so the build left it out.\n  │ FOLDER _locales/fr\n  │ Stores reject a locale folder that has no messages.json file.\n  │ Add a messages.json file to ship the folder, or delete the folder to silence this warning.'
          ]
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] Diagnostic compiled with warnings in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      Diagnostic 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '.',
        '├─ manifest.json (N KB)',
        '└─ _locales',
        '   └─ en',
        '      └─ messages.json (N KB)',
        '',
        '⏵⏵⏵ Warning: A locale folder has no messages.json file, so the build left it out. (<project>/_locales/fr)',
        'FOLDER _locales/fr',
        'Stores reject a locale folder that has no messages.json file.',
        'Add a messages.json file to ship the folder, or delete the folder to silence this warning.',
        '│  Source: bundler',
        '⏵⏵⏵ Extension built for production in dist/chromium (N B).',
        "⏵⏵⏵ Built with Node <node> and Extension.js <version>. Name these versions in the store's reviewer note so a reviewer can rebuild it and match these bytes.",
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_ENV_NO_MATCH',
    label: 'an .env file that matches no browser or mode',
    files: {'manifest.json': mv3(), '.env.staging': 'EXTENSION_PUBLIC_A=1'},
    args: [],
    expected: {
      status: 0,
      frames: [
        {
          schema: 1,
          ok: true,
          command: 'build',
          status: 'built',
          value: {
            projectPath: '.',
            browsers: ['chromium'],
            mode: 'production',
            summaries: [
              {
                browser: 'chromium',
                buildType: 'production',
                output_path: '<project>/dist/chromium',
                total_assets: 1,
                total_bytes: 0,
                largest_asset_bytes: 0,
                warnings_count: 1,
                errors_count: 0,
                warnings: [
                  'E_ENV_NO_MATCH: Found .env.staging, but none match browser chromium in mode production.\n  │ EXTENSION_PUBLIC_* variables read from code are undefined in this build.\n  │ Rename the file to one of these, in priority order: .env.chromium.production, .env.chromium, .env.chrome.production, .env.chrome, .env.edge.production, .env.edge, .env.chromium-based.production, .env.chromium-based, .env.production, .env.local, .env.\n  │ Family names apply to every family member, so .env.chrome also matches chromium and edge targets.'
                ],
                toolchain: {
                  node: '<node>',
                  extension_js: '<version>'
                },
                addon_lint: {
                  status: 'skipped',
                  reason: 'browser'
                }
              }
            ]
          },
          error: null,
          warnings: [
            'E_ENV_NO_MATCH: Found .env.staging, but none match browser chromium in mode production.\n  │ EXTENSION_PUBLIC_* variables read from code are undefined in this build.\n  │ Rename the file to one of these, in priority order: .env.chromium.production, .env.chromium, .env.chrome.production, .env.chrome, .env.edge.production, .env.edge, .env.chromium-based.production, .env.chromium-based, .env.production, .env.local, .env.\n  │ Family names apply to every family member, so .env.chrome also matches chromium and edge targets.'
          ]
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] Diagnostic compiled with warnings in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      Diagnostic 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '.',
        '└─ manifest.json (N KB)',
        '',
        '⏵⏵⏵ Compatibility: Found .env.staging, but none match browser chromium in mode production.',
        'EXTENSION_PUBLIC_* variables read from code are undefined in this build.',
        'Rename the file to one of these, in priority order: .env.chromium.production, .env.chromium, .env.chrome.production, .env.chrome, .env.edge.production, .env.edge, .env.chromium-based.production, .env.chromium-based, .env.production, .env.local, .env.',
        'Family names apply to every family member, so .env.chrome also matches chromium and edge targets.',
        '│  Source: bundler',
        '⏵⏵⏵ Extension built for production in dist/chromium (N B).',
        "⏵⏵⏵ Built with Node <node> and Extension.js <version>. Name these versions in the store's reviewer note so a reviewer can rebuild it and match these bytes.",
        ''
      ].join('\n')
    }
  },
  {
    code: 'E_SCRIPT_DEP_MISSING',
    label: 'a require() that resolves to nothing',
    files: {
      'manifest.json': mv3({background: {service_worker: 'bg.js'}}),
      'bg.js':
        "if (globalThis.x) require('not-a-real-pkg-xyz')\nconsole.log(1)\n"
    },
    args: [],
    expected: {
      status: 0,
      frames: [
        {
          schema: 1,
          ok: true,
          command: 'build',
          status: 'built',
          value: {
            projectPath: '.',
            browsers: ['chromium'],
            mode: 'production',
            summaries: [
              {
                browser: 'chromium',
                buildType: 'production',
                output_path: '<project>/dist/chromium',
                total_assets: 2,
                total_bytes: 0,
                largest_asset_bytes: 0,
                warnings_count: 1,
                errors_count: 0,
                warnings: [
                  "E_SCRIPT_DEP_MISSING: require('not-a-real-pkg-xyz') in <project>/bg.js does not resolve to any module; the call is left verbatim in the output. Chrome loads the script anyway. It only throws if that code path runs (vendored pre-bundled libraries often carry dead require() branches). Install the package if it's a real dependency, or set EXTENSION_STRICT_REFS=true to make this fail the build."
                ],
                toolchain: {
                  node: '<node>',
                  extension_js: '<version>'
                },
                addon_lint: {
                  status: 'skipped',
                  reason: 'browser'
                }
              }
            ]
          },
          error: null,
          warnings: [
            "E_SCRIPT_DEP_MISSING: require('not-a-real-pkg-xyz') in <project>/bg.js does not resolve to any module; the call is left verbatim in the output. Chrome loads the script anyway. It only throws if that code path runs (vendored pre-bundled libraries often carry dead require() branches). Install the package if it's a real dependency, or set EXTENSION_STRICT_REFS=true to make this fail the build."
          ]
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] Diagnostic compiled with warnings in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      Diagnostic 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '.',
        '├─ background',
        '│  └─ service_worker.js (N KB)',
        '└─ manifest.json (N KB)',
        '',
        "⏵⏵⏵ Warning: require('not-a-real-pkg-xyz') in <project>/bg.js does not resolve to any module; the call is left verbatim in the output. Chrome loads the script anyway. It only throws if that code path runs (vendored pre-bundled libraries often carry dead require() branches). Install the package if it's a real dependency, or set EXTENSION_STRICT_REFS=true to make this fail the build.",
        '│  Source: bundler',
        '│  Hint: Re-run with EXTENSION_VERBOSE=1 to inspect full warning details.',
        '⏵⏵⏵ Extension built for production in dist/chromium (N B).',
        "⏵⏵⏵ Built with Node <node> and Extension.js <version>. Name these versions in the store's reviewer note so a reviewer can rebuild it and match these bytes.",
        ''
      ].join('\n')
    }
  },
  // Pins today's behavior. Ledger 1375 N15.
  {
    code: 'E_ZIP_SKIPPED',
    label: 'a folder where the requested zip has to go',
    files: {
      'manifest.json': mv3({name: 'zipped'}),
      'dist/zipped-1.0.0-chromium.zip': null
    },
    args: ['--zip'],
    expected: {
      status: 1,
      frames: [
        {
          schema: 1,
          ok: false,
          command: 'build',
          status: 'build-failed',
          value: null,
          error: {
            code: 'E_ZIP_SKIPPED',
            message: '1 requested archive was not created'
          },
          warnings: [],
          hint: 'Fix the error above and run build again.'
        }
      ],
      stderr: [
        '⏵⏵⏵ [hh:mm:ss] zipped compiled in N ms.',
        ' ',
        ' 🧩 Extension.js <version>',
        '    Browser        Chromium',
        '    Extension      zipped 1.0.0',
        '    Output         <project>/dist/chromium',
        ' ',
        '.',
        '└─ manifest.json (N KB)',
        '',
        '⏵⏵⏵ Extension built for production in dist/chromium (N B).',
        "⏵⏵⏵ Built with Node <node> and Extension.js <version>. Name these versions in the store's reviewer note so a reviewer can rebuild it and match these bytes.",
        '⏵⏵⏵ The distribution zip was requested and not created.',
        'PATH dist/zipped-1.0.0-chromium.zip',
        "EISDIR: illegal operation on a directory, open '<project>/dist/zipped-1.0.0-chromium.zip'",
        '⏵⏵⏵ 1 requested archive was not created',
        '⏵⏵⏵ Build failed with 1 error.',
        ''
      ].join('\n')
    }
  }
]

// One build per coded diagnostic the compiled CLI can raise with no browser,
// read whole: exit code, the one frame, and stderr with the clock named.
// Paths print with the native separator, and these rows are written for posix.
describe.skipIf(process.platform === 'win32')(
  'each coded build diagnostic, read off the compiled CLI',
  () => {
    it.each(DIAGNOSTIC_ROWS)('$code: $label', async ({
      files,
      args,
      expected
    }) => {
      const projectDir = realpathSync(makeTempFolder('extjs-diagnostic-'))

      for (const [file, body] of Object.entries(files)) {
        const full = join(projectDir, file)

        mkdirSync(dirname(full), {recursive: true})

        if (body === null) mkdirSync(full, {recursive: true})
        else {
          writeFileSync(
            full,
            typeof body === 'string' ? body : JSON.stringify(body)
          )
        }
      }

      const run = await runCli(['build', '.', ...args, '--output', 'json'], {
        cwd: projectDir,
        env
      })
      const placeholders: Array<[string, string]> = [[projectDir, '<project>']]
      const actual = {
        status: run.status,
        frames: everyLineAsFrame(run.stdout).map((frame) =>
          normalizeFrame(frame, placeholders)
        ),
        stderr: normalizeTranscript(run.stderr, placeholders)
      }

      expect(actual).toEqual(expected)
    })
  }
)
