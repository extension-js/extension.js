import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
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

// What the stand-in prints on stdout, the stream a real manager reports on.
const STAND_IN_STDOUT = 'stand-in manager: added 1 package in 12ms'

// A package manager of the spec's own: it prints on both streams and writes
// only under the folder STAND_IN_INSTALL_ROOT names, so no registry decides.
const STAND_IN_MANAGER = `
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.STAND_IN_INSTALL_ROOT
const log = process.env.STAND_IN_ARGV_LOG

if (!root || !path.isAbsolute(root) || !log || !path.isAbsolute(log)) {
  process.stderr.write('stand-in manager: no folder named\\n')
  process.exit(2)
}

fs.writeFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n')
process.stdout.write(${JSON.stringify(STAND_IN_STDOUT)} + '\\n')
process.stderr.write('stand-in manager: one warning on stderr\\n')

const target = path.join(root, 'node_modules', 'picocolors')
fs.mkdirSync(target, {recursive: true})
fs.writeFileSync(
  path.join(target, 'package.json'),
  JSON.stringify({name: 'picocolors', version: '1.1.1', main: 'index.js'})
)
fs.writeFileSync(path.join(target, 'index.js'), 'module.exports = {}\\n')
`

describe('build --output json on a project whose dependencies are not installed', () => {
  let projectDir = ''
  let managerPath = ''
  let argvLog = ''

  beforeAll(() => {
    const tools = makeTempFolder('extjs-json-install-manager-')

    managerPath = join(tools, 'stand-in-manager.cjs')
    argvLog = join(tools, 'argv.json')
    writeFileSync(managerPath, STAND_IN_MANAGER)

    projectDir = makeTempFolder('extjs-json-install-stdout-')
    mkdirSync(join(projectDir, 'content'))
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'json-install-stdout',
        private: true,
        version: '1.0.0',
        dependencies: {picocolors: '1.1.1'}
      })
    )

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
  })

  it('keeps the package manager output off stdout', async () => {
    const run = await runCli(
      ['build', '.', '--browser=chromium', '--output', 'json'],
      {
        cwd: projectDir,
        env: {
          EXTENSION_DEBUG: '0',
          EXTENSION_JS_PACKAGE_MANAGER: 'npm',
          EXTENSION_JS_PM_EXEC_PATH: managerPath,
          STAND_IN_INSTALL_ROOT: projectDir,
          STAND_IN_ARGV_LOG: argvLog
        }
      }
    )
    const transcript = [
      `exit ${run.status}`,
      `stdout:\n${run.stdout}`,
      `stderr:\n${run.stderr}`
    ].join('\n')

    expect(run.status, transcript).toBe(0)

    // The stand-in ran as the install, and it is the only writer of this file.
    expect(existsSync(argvLog), transcript).toBe(true)
    expect(
      (JSON.parse(readFileSync(argvLog, 'utf8')) as string[])[0],
      transcript
    ).toBe('install')

    expect(
      existsSync(join(projectDir, 'node_modules', 'picocolors')),
      transcript
    ).toBe(true)

    const emitted = frames(run.stdout)
    expect(emitted, transcript).toHaveLength(1)
    expect(emitted[0].ok).toBe(true)
    expect(emitted[0].command).toBe('build')
    expect(emitted[0].status).toBe('built')

    expect(run.stdout, transcript).not.toContain('stand-in manager')
    expect(run.stderr, transcript).toContain(STAND_IN_STDOUT)
    expect(run.stderr, transcript).toContain(
      'stand-in manager: one warning on stderr'
    )

    expect(run.stderr, transcript).toContain(
      'Installing the project dependencies'
    )
  }, 180_000)
})
