import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

interface Diagnostic {
  code?: string
  message: string
  file?: string
  line?: number
  column?: number
  severity: string
  name?: string
}

interface BuildFailure extends Error {
  code?: string
  diagnostics?: Diagnostic[]
  truncated?: boolean
}

function project(
  manifest: Record<string, unknown>,
  files: Record<string, string>
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-diagnostic-codes-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'diagnostic-codes',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'diagnostic-codes',
      version: '1.0.0',
      ...manifest
    }),
    ...files
  }

  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } finally {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

async function failure(root: string): Promise<BuildFailure> {
  return build(root).then(
    () => {
      throw new Error('the build was expected to fail')
    },
    (error: BuildFailure) => error
  )
}

const contentScript = {
  content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
}

describe('a failed build names each diagnostic with its code', () => {
  it('codes a module that cannot be resolved', async () => {
    const root = project(
      {background: {service_worker: 'background.js'}},
      {'background.js': "import './missing-dep-token'\nconsole.log('x')\n"}
    )

    const error = await failure(root)
    expect(error.message).toBe('Build failed with errors')
    expect(error.code).toBe('E_COMPILE')
    expect(error.truncated).toBe(false)
    expect(error.diagnostics).toHaveLength(1)
    expect(error.diagnostics?.[0]).toMatchObject({
      code: 'E_MODULE_NOT_FOUND',
      file: 'background.js',
      line: 1,
      column: 1,
      severity: 'error'
    })

    expect(error.diagnostics?.[0].message).toMatch(
      /^Module not found: Can't resolve '\.\/missing-dep-token'/
    )
  }, 120_000)

  it('codes a content script that does not parse', async () => {
    const root = project(contentScript, {
      'content/scripts.js': 'const brokenToken = ;\n'
    })

    const error = await failure(root)
    expect(error.code).toBe('E_COMPILE')
    expect(error.diagnostics).toHaveLength(1)
    expect(error.diagnostics?.[0]).toMatchObject({
      code: 'E_CONTENT_SCRIPT_SYNTAX',
      file: 'content/scripts.js',
      severity: 'error',
      name: 'ModuleBuildError'
    })

    expect(error.diagnostics?.[0].message).toContain('const brokenToken = ;')
  }, 120_000)

  it('codes a web accessible resource match pattern the browser rejects', async () => {
    const root = project(
      {
        background: {service_worker: 'background.js'},
        web_accessible_resources: [
          {resources: ['public/a.txt'], matches: ['not-a-pattern-token']}
        ]
      },
      {'background.js': "console.log('war')\n", 'public/a.txt': 'a\n'}
    )

    const error = await failure(root)
    expect(error.code).toBe('E_COMPILE')
    expect(error.diagnostics?.[0]).toMatchObject({
      code: 'E_WAR_INVALID',
      file: 'manifest.json',
      severity: 'error',
      name: 'WARInvalidMatchPattern'
    })

    expect(error.diagnostics?.[0].message).toContain('not-a-pattern-token')
    expect(error.diagnostics?.[0].message).not.toMatch(/^[×⚠]/)
  }, 120_000)
})

describe('a green build prefixes a coded warning with its code', () => {
  it('codes a stylesheet url() that points at nothing', async () => {
    const root = project(
      {
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/scripts.js'],
            css: ['content/styles.css']
          }
        ]
      },
      {
        'content/scripts.js': "console.log('dead')\n",
        'content/styles.css': 'a { background: url(./nope-token.png); }\n'
      }
    )

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBe(1)
    expect(summary.warnings?.[0]).toMatch(
      /^E_CSS_DEAD_REF: A url\(\.\/nope-token\.png\) reference points to a file that exists nowhere in the project\./
    )
  }, 120_000)

  it('codes a stylesheet that does not parse and was copied as is', async () => {
    const root = project(
      {
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/scripts.js'],
            css: ['content/styles.css']
          }
        ]
      },
      {
        'content/scripts.js': "console.log('css')\n",
        'content/styles.css': 'a { color: red\n.b { }}} {{\n'
      }
    )

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBe(1)
    expect(summary.warnings?.[0]).toMatch(/^E_CSS_PARSE: Module Warning/)
    expect(summary.warnings?.[0]).toContain("doesn't parse")
  }, 120_000)
})
