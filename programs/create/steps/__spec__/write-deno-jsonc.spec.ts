import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {writeDenoJsonc} from '../write-deno-jsonc'

function withDenoGlobal(body: () => Promise<void> | void) {
  const hadDeno = 'Deno' in globalThis
  ;(globalThis as {Deno?: unknown}).Deno = {version: {deno: 'test'}}
  return Promise.resolve(body()).finally(() => {
    if (!hadDeno) delete (globalThis as {Deno?: unknown}).Deno
  })
}

const noopLogger = {log() {}, error() {}}

function parseJsonc(contents: string): Record<string, any> {
  const withoutComments = contents
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  return JSON.parse(withoutComments)
}

describe('writeDenoJsonc', () => {
  let tmpRoot: string
  let projectPath: string
  const prevDevelopRoot = process.env.EXTENSION_CREATE_DEVELOP_ROOT
  const prevExtensionEnv = process.env.EXTENSION_ENV

  beforeEach(async () => {
    delete process.env.EXTENSION_CREATE_DEVELOP_ROOT
    delete process.env.EXTENSION_ENV
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ext-deno-jsonc-'))
    projectPath = path.join(tmpRoot, 'my-ext')
    await fsp.mkdir(projectPath, {recursive: true})
  })

  afterEach(async () => {
    delete (globalThis as {Deno?: unknown}).Deno
    if (prevDevelopRoot !== undefined) {
      process.env.EXTENSION_CREATE_DEVELOP_ROOT = prevDevelopRoot
    }
    if (prevExtensionEnv !== undefined) {
      process.env.EXTENSION_ENV = prevExtensionEnv
    }
    await fsp.rm(tmpRoot, {recursive: true, force: true})
  })

  it('does nothing outside the Deno runtime', async () => {
    await writeDenoJsonc(projectPath, {}, noopLogger)
    await expect(
      fsp.access(path.join(projectPath, 'deno.jsonc'))
    ).rejects.toThrow()
  })

  it('writes a parseable deno.jsonc with tasks and nodeModulesDir', async () => {
    await withDenoGlobal(async () => {
      await writeDenoJsonc(projectPath, {}, noopLogger)
    })

    const contents = await fsp.readFile(
      path.join(projectPath, 'deno.jsonc'),
      'utf8'
    )
    expect(contents).toContain('//')

    const config = parseJsonc(contents)
    expect(config.nodeModulesDir).toBe('auto')
    expect(config.tasks).toMatchObject({
      dev: 'extension dev',
      start: 'extension start',
      build: 'extension build',
      preview: 'extension preview',
      'build:chrome': 'extension build --browser chrome',
      'build:firefox': 'extension build --browser firefox',
      'build:edge': 'extension build --browser edge'
    })
  })

  it('targets packages/extension for monorepo templates', async () => {
    await withDenoGlobal(async () => {
      await writeDenoJsonc(
        projectPath,
        {template: 'monorepo-basic'},
        noopLogger
      )
    })

    const config = parseJsonc(
      await fsp.readFile(path.join(projectPath, 'deno.jsonc'), 'utf8')
    )
    expect(config.tasks.dev).toBe('extension dev packages/extension')
    expect(config.tasks.build).toBe('extension build packages/extension')
  })

  it('primary mode moves template dependencies into imports and removes package.json', async () => {
    await fsp.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({
        name: 'template',
        author: {
          name: 'Template Author',
          email: 'template@example.com',
          url: 'https://template.example.com'
        },
        dependencies: {react: '^18.3.1', 'react-dom': '^18.3.1'},
        devDependencies: {typescript: '5.3.3'}
      })
    )

    await withDenoGlobal(async () => {
      await writeDenoJsonc(
        projectPath,
        {cliVersion: '4.0.5', primary: true},
        noopLogger
      )
    })

    const contents = await fsp.readFile(
      path.join(projectPath, 'deno.jsonc'),
      'utf8'
    )
    const config = parseJsonc(contents)
    expect(config.imports).toMatchObject({
      react: 'npm:react@^18.3.1',
      'react-dom': 'npm:react-dom@^18.3.1',
      typescript: 'npm:typescript@5.3.3',
      extension: 'npm:extension@^4.0.5'
    })
    expect(config.nodeModulesDir).toBe('auto')
    expect(config.tasks.dev).toBe('extension dev')
    expect(contents).not.toContain('Template Author')
    expect(contents).not.toContain('template@example.com')

    await expect(
      fsp.access(path.join(projectPath, 'package.json'))
    ).rejects.toThrow()
  })

  it('primary mode pins canary CLI versions exactly', async () => {
    await withDenoGlobal(async () => {
      await writeDenoJsonc(
        projectPath,
        {cliVersion: '4.0.5-canary.1', primary: true},
        noopLogger
      )
    })

    const config = parseJsonc(
      await fsp.readFile(path.join(projectPath, 'deno.jsonc'), 'utf8')
    )
    expect(config.imports.extension).toBe('npm:extension@4.0.5-canary.1')
  })

  it('primary mode works without a template package.json', async () => {
    await withDenoGlobal(async () => {
      await writeDenoJsonc(projectPath, {primary: true}, noopLogger)
    })

    const config = parseJsonc(
      await fsp.readFile(path.join(projectPath, 'deno.jsonc'), 'utf8')
    )
    expect(Object.keys(config.imports)).toEqual(['extension'])
    expect(config.imports.extension).not.toBe('npm:extension@latest')
    expect(config.imports.extension).toMatch(/^npm:extension@\^?\d+\.\d+\.\d+/)
  })

  it('keeps a Deno config the template already ships', async () => {
    const templateConfig = '{"tasks": {"dev": "custom"}}\n'
    await fsp.writeFile(path.join(projectPath, 'deno.json'), templateConfig)

    await withDenoGlobal(async () => {
      await writeDenoJsonc(projectPath, {}, noopLogger)
    })

    await expect(
      fsp.access(path.join(projectPath, 'deno.jsonc'))
    ).rejects.toThrow()
    expect(
      await fsp.readFile(path.join(projectPath, 'deno.json'), 'utf8')
    ).toBe(templateConfig)
  })

  it('primary mode folds the extension import into a template deno.json', async () => {
    await fsp.writeFile(
      path.join(projectPath, 'deno.json'),
      '{"tasks": {"dev": "custom"}, "imports": {"preact": "npm:preact@10.0.0"}}\n'
    )
    await fsp.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({name: 'template', dependencies: {react: '^18.3.1'}})
    )

    await withDenoGlobal(async () => {
      await writeDenoJsonc(
        projectPath,
        {cliVersion: '4.0.5', primary: true},
        noopLogger
      )
    })

    const config = parseJsonc(
      await fsp.readFile(path.join(projectPath, 'deno.json'), 'utf8')
    )
    // The template config stays authoritative where it speaks, but the
    // scaffold contract still lands: extension import, deps, no package.json.
    expect(config.tasks.dev).toBe('custom')
    // Tasks the template did not define still come from the scaffold defaults.
    expect(config.tasks.build).toBe('extension build')
    expect(config.tasks.start).toBe('extension start')
    expect(config.imports.preact).toBe('npm:preact@10.0.0')
    expect(config.imports.react).toBe('npm:react@^18.3.1')
    expect(config.imports.extension).toBe('npm:extension@^4.0.5')
    expect(config.nodeModulesDir).toBe('auto')

    await expect(
      fsp.access(path.join(projectPath, 'package.json'))
    ).rejects.toThrow()
    await expect(
      fsp.access(path.join(projectPath, 'deno.jsonc'))
    ).rejects.toThrow()
  })

  it('primary mode forces nodeModulesDir auto even when the template turns it off', async () => {
    // Scaffold tasks run the Extension.js CLI out of node_modules/.bin. A
    // template that sets nodeModulesDir to "none" would leave those tasks
    // unable to resolve their tooling.
    await fsp.writeFile(
      path.join(projectPath, 'deno.json'),
      JSON.stringify({
        nodeModulesDir: 'none',
        imports: {preact: 'npm:preact@10.0.0'},
        tasks: {fmt: 'deno fmt'}
      }) + '\n'
    )
    await fsp.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({name: 'template'})
    )

    await withDenoGlobal(async () => {
      await writeDenoJsonc(
        projectPath,
        {cliVersion: '4.0.5', primary: true},
        noopLogger
      )
    })

    const config = parseJsonc(
      await fsp.readFile(path.join(projectPath, 'deno.json'), 'utf8')
    )
    expect(config.nodeModulesDir).toBe('auto')
    expect(config.imports.preact).toBe('npm:preact@10.0.0')
    expect(config.tasks.fmt).toBe('deno fmt')
    expect(config.tasks.dev).toBe('extension dev')
  })

  it('primary mode rewrites a template-pinned extension to the scaffolding CLI version', async () => {
    // Templates pin extension to whatever they were written against. npm
    // scaffolds rewrite that pin to the invoking CLI; Deno must do the same
    // so the first `deno task dev` is not an old package against a new CLI.
    await fsp.writeFile(
      path.join(projectPath, 'deno.json'),
      JSON.stringify({
        imports: {
          preact: 'npm:preact@10.0.0',
          extension: 'npm:extension@^2.1.0'
        }
      }) + '\n'
    )
    await fsp.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({
        name: 'template',
        dependencies: {react: '^18.3.1'},
        devDependencies: {extension: '^2.1.0'}
      })
    )

    await withDenoGlobal(async () => {
      await writeDenoJsonc(
        projectPath,
        {cliVersion: '4.0.5', primary: true},
        noopLogger
      )
    })

    const config = parseJsonc(
      await fsp.readFile(path.join(projectPath, 'deno.json'), 'utf8')
    )
    expect(config.imports.extension).toBe('npm:extension@^4.0.5')
    // Everything else the template pinned stays the template's choice.
    expect(config.imports.preact).toBe('npm:preact@10.0.0')
    expect(config.imports.react).toBe('npm:react@^18.3.1')
  })

  it('primary mode merges scaffold tasks under a template that only adds its own', async () => {
    // Templates often ship deno.json with just fmt (or similar); that must
    // not wipe the scaffold contract that the banner and README advertise.
    await fsp.writeFile(
      path.join(projectPath, 'deno.json'),
      '{"tasks": {"fmt": "deno fmt"}}\n'
    )
    await fsp.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({name: 'template'})
    )

    await withDenoGlobal(async () => {
      await writeDenoJsonc(
        projectPath,
        {cliVersion: '4.0.5', primary: true},
        noopLogger
      )
    })

    const config = parseJsonc(
      await fsp.readFile(path.join(projectPath, 'deno.json'), 'utf8')
    )
    expect(config.tasks.fmt).toBe('deno fmt')
    expect(config.tasks.dev).toBe('extension dev')
    expect(config.tasks.build).toBe('extension build')
    expect(config.tasks.start).toBe('extension start')
    expect(config.tasks.preview).toBe('extension preview')
    expect(config.tasks['build:firefox']).toBe(
      'extension build --browser firefox'
    )
    expect(config.imports.extension).toBe('npm:extension@^4.0.5')
  })

  it('primary mode updates deno.json when deno.jsonc also exists', async () => {
    const jsoncContents = '{\n  // untouched\n  "tasks": {"dev": "jsonc"}\n}\n'
    await fsp.writeFile(
      path.join(projectPath, 'deno.json'),
      '{"tasks": {"dev": "json"}}\n'
    )
    await fsp.writeFile(path.join(projectPath, 'deno.jsonc'), jsoncContents)

    await withDenoGlobal(async () => {
      await writeDenoJsonc(projectPath, {primary: true}, noopLogger)
    })

    // Deno itself prefers deno.json over deno.jsonc, so that file gains the
    // extension import while the jsonc file stays byte-identical.
    const config = parseJsonc(
      await fsp.readFile(path.join(projectPath, 'deno.json'), 'utf8')
    )
    expect(config.tasks.dev).toBe('json')
    expect(config.imports.extension).toMatch(/^npm:extension@/)
    expect(
      await fsp.readFile(path.join(projectPath, 'deno.jsonc'), 'utf8')
    ).toBe(jsoncContents)
  })
})
