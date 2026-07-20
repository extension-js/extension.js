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
    await writeDenoJsonc(projectPath, 'my-ext', {}, noopLogger)
    await expect(
      fsp.access(path.join(projectPath, 'deno.jsonc'))
    ).rejects.toThrow()
  })

  it('writes a parseable deno.jsonc with tasks and nodeModulesDir', async () => {
    await withDenoGlobal(async () => {
      await writeDenoJsonc(projectPath, 'my-ext', {}, noopLogger)
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
        'my-ext',
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
        dependencies: {react: '^18.3.1', 'react-dom': '^18.3.1'},
        devDependencies: {typescript: '5.3.3'}
      })
    )

    await withDenoGlobal(async () => {
      await writeDenoJsonc(
        projectPath,
        'my-ext',
        {cliVersion: '4.0.5', primary: true},
        noopLogger
      )
    })

    const config = parseJsonc(
      await fsp.readFile(path.join(projectPath, 'deno.jsonc'), 'utf8')
    )
    expect(config.imports).toMatchObject({
      react: 'npm:react@^18.3.1',
      'react-dom': 'npm:react-dom@^18.3.1',
      typescript: 'npm:typescript@5.3.3',
      extension: 'npm:extension@^4.0.5'
    })
    expect(config.nodeModulesDir).toBe('auto')
    expect(config.tasks.dev).toBe('extension dev')

    await expect(
      fsp.access(path.join(projectPath, 'package.json'))
    ).rejects.toThrow()
  })

  it('primary mode pins canary CLI versions exactly', async () => {
    await withDenoGlobal(async () => {
      await writeDenoJsonc(
        projectPath,
        'my-ext',
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
      await writeDenoJsonc(projectPath, 'my-ext', {primary: true}, noopLogger)
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
      await writeDenoJsonc(projectPath, 'my-ext', {}, noopLogger)
    })

    await expect(
      fsp.access(path.join(projectPath, 'deno.jsonc'))
    ).rejects.toThrow()
    expect(
      await fsp.readFile(path.join(projectPath, 'deno.json'), 'utf8')
    ).toBe(templateConfig)
  })
})
