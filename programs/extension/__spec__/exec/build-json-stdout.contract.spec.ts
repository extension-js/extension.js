import {existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type OfflineRegistryFixture,
  offlineRegistryEnv,
  offlineRegistryFiles,
  serveOfflineRegistry
} from '../../../create/__spec__/offline-registry-fixture'
import {type CliRun, everyLineAsFrame, runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()

const DEBUG_GLYPH = '···'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+p1a9+gAAAABJRU5ErkJggg==',
  'base64'
)

interface Frame {
  ok: boolean
  command: string
  status: string
  warnings: string[]
  value: {
    summaries: Array<{
      output_path: string
      total_assets: number
      warnings?: string[]
      warnings_count: number
    }>
  }
}

function frames(stdout: string): Frame[] {
  return everyLineAsFrame<Frame>(stdout)
}

// One project that trips the locales, icons, css and TypeScript debug lines,
// so both diagnostics tests read a single build.
function writeDebugFixture(projectDir: string): void {
  mkdirSync(join(projectDir, 'content'), {recursive: true})
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
        {
          matches: ['<all_urls>'],
          js: ['content.js', 'content/scripts.ts'],
          css: ['content.css']
        }
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

  writeFileSync(
    join(projectDir, 'tsconfig.json'),
    JSON.stringify({compilerOptions: {strict: true}})
  )

  writeFileSync(
    join(projectDir, 'content', 'scripts.ts'),
    "const token: string = 'json-debug-ts-fixture'\nconsole.log(token)\n"
  )
}

describe('build --output json with diagnostics on', () => {
  let run: CliRun

  beforeAll(async () => {
    const work = makeTempFolder('extjs-debug-stdout-')
    const projectDir = join(work, 'debug-stdout-probe')

    writeDebugFixture(projectDir)
    run = await runCli(['build', projectDir, '--output', 'json'], {
      cwd: work,
      env: {EXTENSION_DEBUG: '1'}
    })
  }, 150_000)

  it('keeps stdout to the one envelope and sends every debug line to stderr', () => {
    const stdoutLines = run.stdout.split('\n').filter((line) => line)

    expect(run.status, run.output).toBe(0)
    expect(stdoutLines, run.stdout).toHaveLength(1)

    const frame = JSON.parse(stdoutLines[0]) as Frame
    expect(frame.ok).toBe(true)
    expect(frame.command).toBe('build')
    expect(frame.status).toBe('built')
    expect(frame.value.summaries[0].output_path).toContain('debug-stdout-probe')

    const debugLines = run.stderr
      .split('\n')
      .filter((line) => line.includes(DEBUG_GLYPH))
    expect(debugLines.length, run.stderr).toBeGreaterThan(10)

    for (const feature of ['locales', 'icons', 'css', 'manifest']) {
      expect(
        debugLines.some((line) => line.includes(` ${feature} `)),
        `${feature} debug line expected on stderr\n${run.stderr}`
      ).toBe(true)
    }

    expect(run.stderr).toContain('locales  emitted=2')
    expect(run.stdout).not.toContain(DEBUG_GLYPH)
  })

  it('keeps the using TypeScript debug line off stdout and ends on the built envelope', () => {
    const out = run.stdout.split('\n').filter((line) => line.trim())

    expect(run.status).toBe(0)
    expect(out.some((line) => /use=TypeScript/.test(line))).toBe(false)
    expect(run.stderr).toMatch(/use=TypeScript/)
    expect(JSON.parse(out[out.length - 1])).toMatchObject({
      ok: true,
      command: 'build',
      status: 'built'
    })
  })
})

// A project of its own per test, so neither reads what the other built.
function createProject(): string {
  const projectDir = makeTempFolder('extjs-json-ts-stdout-')

  mkdirSync(join(projectDir, 'content'))
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({name: 'json-ts-stdout', private: true, version: '1.0.0'})
  )

  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'JSON TS Stdout',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.ts']}]
    })
  )

  writeFileSync(
    join(projectDir, 'content', 'scripts.ts'),
    "const token: string = 'json-ts-stdout-fixture'\nconsole.log(token)\n"
  )

  return projectDir
}

describe('build --output json on a fresh TypeScript project', () => {
  it('keeps the tsconfig and type definition lines off stdout', async () => {
    const projectDir = createProject()
    const run = await runCli(
      ['build', '.', '--browser=chromium', '--output', 'json'],
      {cwd: projectDir}
    )

    expect(run.status).toBe(0)
    expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(projectDir, 'extension-env.d.ts'))).toBe(true)

    const emitted = frames(run.stdout)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].ok).toBe(true)
    expect(emitted[0].command).toBe('build')
    expect(emitted[0].status).toBe('built')

    expect(run.stderr).toContain('Creating a default tsconfig.json')
    expect(run.stderr).toContain(
      'Writing the type definitions for JSON TS Stdout'
    )
  }, 180_000)

  it('keeps the type definition update line off stdout too', async () => {
    const projectDir = createProject()

    writeFileSync(join(projectDir, 'extension-env.d.ts'), '// stale\n')

    const run = await runCli(
      ['build', '.', '--browser=chromium', '--output', 'json'],
      {cwd: projectDir}
    )

    expect(run.status).toBe(0)

    const emitted = frames(run.stdout)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].ok).toBe(true)
    expect(emitted[0].status).toBe('built')

    expect(run.stderr).toContain('Updating the type definitions')
  }, 180_000)
})

describe('build --output json on a project whose config loads a managed package', () => {
  let projectDir = ''

  beforeAll(() => {
    projectDir = makeTempFolder('extjs-json-coded-warnings-')
    mkdirSync(join(projectDir, 'node_modules', '.pnpm'), {recursive: true})
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'json-coded-warnings',
        private: true,
        version: '1.0.0',
        dependencies: {'@rspack/core': '^2.0.0'}
      })
    )

    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'JSON Coded Warnings',
        version: '1.0.0',
        background: {service_worker: 'background.js'}
      })
    )

    writeFileSync(
      join(projectDir, 'background.js'),
      "console.log('json-coded-warnings-fixture')\n"
    )

    writeFileSync(
      join(projectDir, 'extension.config.js'),
      "const lazy = () => require('@rspack/core')\nmodule.exports = {}\n"
    )
  })

  it('names the managed copy with its code on the frame and in the summary', async () => {
    const run = await runCli(
      ['build', '.', '--browser=chromium', '--output', 'json'],
      {cwd: projectDir}
    )

    expect(run.status).toBe(0)

    const emitted = frames(run.stdout)
    expect(emitted).toHaveLength(1)

    const [frame] = emitted
    expect(frame.ok).toBe(true)
    expect(frame.status).toBe('built')
    expect(frame.warnings).toHaveLength(1)
    expect(frame.warnings[0]).toMatch(
      /^W_MANAGED_DEP_CONFLICT: extension\.config\.js loads its own copy of @rspack\/core \(Extension\.js ships \S+\)\.$/
    )

    const [summary] = frame.value.summaries
    expect(summary.warnings).toContain(frame.warnings[0])
    expect(summary.warnings_count).toBe(summary.warnings?.length)

    expect(run.stderr).toContain('loads its own copy of a package')
  }, 180_000)
})

// A real package manager runs here, against a loopback registry that
// answers 404 and logs every request, so it keeps a describe of its own.
describe('build --output json on a project whose dependencies are not installed', () => {
  let projectDir = ''
  let registry: OfflineRegistryFixture

  beforeAll(async () => {
    registry = await serveOfflineRegistry()

    projectDir = makeTempFolder('extjs-json-install-stdout-')
    mkdirSync(join(projectDir, 'content'))
    mkdirSync(join(projectDir, 'vendor', 'picocolors'), {recursive: true})
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'json-install-stdout',
        private: true,
        version: '1.0.0',
        dependencies: {picocolors: 'file:./vendor/picocolors'}
      })
    )

    writeFileSync(
      join(projectDir, 'vendor', 'picocolors', 'package.json'),
      JSON.stringify({name: 'picocolors', version: '1.1.1', main: 'index.js'})
    )

    writeFileSync(
      join(projectDir, 'vendor', 'picocolors', 'index.js'),
      'module.exports = {}\n'
    )

    for (const [file, content] of Object.entries(
      offlineRegistryFiles(registry.url)
    )) {
      writeFileSync(join(projectDir, file), content)
    }

    writeFileSync(join(projectDir, '.npmrc'), 'offline=true\n', {flag: 'a'})

    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'JSON Install Stdout',
        version: '1.0.0',
        content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
      })
    )

    writeFileSync(
      join(projectDir, 'content', 'scripts.js'),
      "console.log('json-install-stdout-fixture')\n"
    )
  }, 60_000)

  afterAll(async () => {
    await registry?.close()
  })

  it('keeps the package manager output off stdout', async () => {
    // The helper's env inherits no registry, and the package manager keeps
    // its cache and store in the temp home.
    const run = await runCli(
      ['build', '.', '--browser=chromium', '--output', 'json'],
      {
        cwd: projectDir,
        env: {EXTENSION_DEBUG: '0', ...offlineRegistryEnv(registry.url)}
      }
    )
    const transcript = [
      `exit ${run.status}`,
      `the loopback registry saw: ${registry.requests().join(' ') || 'nothing'}`,
      `stdout:\n${run.stdout}`,
      `stderr:\n${run.stderr}`
    ].join('\n')

    expect(run.status, transcript).toBe(0)
    expect(
      existsSync(join(projectDir, 'node_modules', 'picocolors')),
      transcript
    ).toBe(true)

    expect(
      registry.requests().filter((url) => url.includes('picocolors')),
      transcript
    ).toEqual([])

    const emitted = frames(run.stdout)
    expect(emitted, transcript).toHaveLength(1)
    expect(emitted[0].ok).toBe(true)
    expect(emitted[0].command).toBe('build')
    expect(emitted[0].status).toBe('built')

    expect(run.stderr, transcript).toContain(
      'Installing the project dependencies'
    )
  }, 180_000)
})
