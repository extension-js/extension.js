import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const runInstallMock = vi.fn()

vi.mock('../../lib/install-runner', () => ({
  runInstall: (...args: unknown[]) => runInstallMock(...args)
}))

vi.mock('../../lib/utils', () => ({
  getInstallCommand: async () => 'npm'
}))

import {installDependencies} from '../install-dependencies'

const noopLogger = {log() {}, error() {}}

describe('installDependencies', () => {
  let projectPath: string
  const prevDeno = (globalThis as {Deno?: unknown}).Deno
  const prevExtensionEnv = process.env.EXTENSION_ENV

  beforeEach(async () => {
    runInstallMock.mockReset()
    delete (globalThis as {Deno?: unknown}).Deno
    delete process.env.EXTENSION_ENV
    projectPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-install-'))
  })

  afterEach(async () => {
    if (prevDeno === undefined) {
      delete (globalThis as {Deno?: unknown}).Deno
    } else {
      ;(globalThis as {Deno?: unknown}).Deno = prevDeno
    }
    if (prevExtensionEnv === undefined) {
      delete process.env.EXTENSION_ENV
    } else {
      process.env.EXTENSION_ENV = prevExtensionEnv
    }
    await fsp.rm(projectPath, {recursive: true, force: true})
  })

  it('installs with the manager the project resolved to, not the invoker', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-install-pm-'))
    try {
      await fsp.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({name: 'seed', dependencies: {left: '1.0.0'}})
      )
      runInstallMock.mockResolvedValue({ok: true, code: 0})
      await installDependencies(dir, 'seed', {log() {}, error() {}}, 'pnpm')
      expect(runInstallMock).toHaveBeenCalled()
      expect(runInstallMock.mock.calls[0][0]).toBe('pnpm')
    } finally {
      await fsp.rm(dir, {recursive: true, force: true})
    }
  })

  it('skips install when package.json declares no dependencies', async () => {
    await fsp.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({name: 'empty', dependencies: {}, devDependencies: {}})
    )

    await installDependencies(projectPath, 'empty', noopLogger)

    expect(runInstallMock).not.toHaveBeenCalled()
  })

  it('skips install when a Deno-primary scaffold has no npm imports', async () => {
    // Primary mode retires package.json; with no npm: imports there is nothing
    // for `deno install` to fetch, so the npm empty-deps skip must apply here.
    await fsp.writeFile(
      path.join(projectPath, 'deno.json'),
      JSON.stringify({tasks: {fmt: 'deno fmt'}, nodeModulesDir: 'auto'})
    )

    ;(globalThis as {Deno?: unknown}).Deno = {version: {deno: 'test'}}
    await installDependencies(projectPath, 'empty-deno', noopLogger)

    expect(runInstallMock).not.toHaveBeenCalled()
  })

  it('runs deno install when the Deno config declares npm imports', async () => {
    await fsp.writeFile(
      path.join(projectPath, 'deno.json'),
      JSON.stringify({
        imports: {extension: 'npm:extension@^4.0.5'},
        nodeModulesDir: 'auto'
      })
    )

    runInstallMock.mockResolvedValue({code: 0, stdout: '', stderr: ''})
    ;(globalThis as {Deno?: unknown}).Deno = {version: {deno: 'test'}}

    await installDependencies(projectPath, 'deno-deps', noopLogger)

    expect(runInstallMock).toHaveBeenCalledTimes(1)
    expect(runInstallMock.mock.calls[0][0]).toBe('deno')
    expect(runInstallMock.mock.calls[0][1]).toEqual(['install'])
  })

  it('fails loudly when package.json exists but cannot be parsed', async () => {
    // A fat-fingered package.json used to skip install (treated as "no deps")
    // and print the ready banner; the broken file only surfaced later.
    await fsp.writeFile(
      path.join(projectPath, 'package.json'),
      '{ name: "broken", devDependencies: { extension: "^4.0.5" }\n'
    )

    await expect(
      installDependencies(projectPath, 'broken-pkg', noopLogger)
    ).rejects.toThrow()

    expect(runInstallMock).not.toHaveBeenCalled()
  })

  it('rewrites a dead extension pin in deno.jsonc, keeps comments, and retries', async () => {
    const authored = `{
  // template-shipped comment must survive recovery
  "imports": {
    "preact": "npm:preact@10.0.0",
    "extension": "npm:extension@^2.1.0"
  },
  "nodeModulesDir": "auto"
}
`
    await fsp.writeFile(path.join(projectPath, 'deno.jsonc'), authored)

    runInstallMock
      .mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr:
          "error: Could not find version of npm package 'extension' matching '^2.1.0'"
      })
      .mockResolvedValueOnce({code: 0, stdout: '', stderr: ''})

    ;(globalThis as {Deno?: unknown}).Deno = {version: {deno: 'test'}}

    await installDependencies(projectPath, 'dead-pin', noopLogger)

    expect(runInstallMock).toHaveBeenCalledTimes(2)

    const contents = await fsp.readFile(
      path.join(projectPath, 'deno.jsonc'),
      'utf8'
    )
    // Floating tag recovery, same contract as the package.json path.
    expect(contents).toContain('"extension": "npm:extension@latest"')
    // Non-extension pins and authored comments stay put.
    expect(contents).toContain('"preact": "npm:preact@10.0.0"')
    expect(contents).toContain(
      '// template-shipped comment must survive recovery'
    )
  })

  it('rewrites the value site, not a comment quoting the same specifier', async () => {
    const authored = `{
  // pinned on purpose: "npm:extension@^2.1.0"
  "imports": {
    "extension": "npm:extension@^2.1.0"
  }
}
`
    await fsp.writeFile(path.join(projectPath, 'deno.jsonc'), authored)

    runInstallMock
      .mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr:
          "error: Could not find version of npm package 'extension' matching '^2.1.0'"
      })
      .mockResolvedValueOnce({code: 0, stdout: '', stderr: ''})

    ;(globalThis as {Deno?: unknown}).Deno = {version: {deno: 'test'}}

    await installDependencies(projectPath, 'comment-collision', noopLogger)

    const contents = await fsp.readFile(
      path.join(projectPath, 'deno.jsonc'),
      'utf8'
    )
    expect(contents).toContain('// pinned on purpose: "npm:extension@^2.1.0"')
    expect(contents).toContain('"extension": "npm:extension@latest"')
  })

  it('rewrites a dead extension pin in package.json and retries install', async () => {
    await fsp.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({
        name: 'npm-project',
        devDependencies: {extension: '^2.1.0'}
      }) + '\n'
    )

    runInstallMock
      .mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr:
          'npm ERR! code ETARGET\nnpm ERR! notarget No matching version found for extension@^2.1.0'
      })
      .mockResolvedValueOnce({code: 0, stdout: '', stderr: ''})

    await installDependencies(projectPath, 'npm-dead-pin', noopLogger)

    expect(runInstallMock).toHaveBeenCalledTimes(2)
    expect(runInstallMock.mock.calls[0][0]).toBe('npm')

    const pkg = JSON.parse(
      await fsp.readFile(path.join(projectPath, 'package.json'), 'utf8')
    )
    expect(pkg.devDependencies.extension).toBe('latest')
  })

  it('does not rewrite a canary pin when install fails for non-version reasons', async () => {
    // Hotel wifi / registry flakiness is not "version gone". Recovery must
    // leave the exact canary the scaffold wrote, and leave JSONC alone.
    const authored = `{
  // keep me
  "imports": {
    "extension": "npm:extension@4.0.5-canary.1"
  },
  "nodeModulesDir": "auto"
}
`
    await fsp.writeFile(path.join(projectPath, 'deno.jsonc'), authored)

    runInstallMock.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr:
        'error: failed to fetch https://registry.npmjs.org/extension: network error (connection reset)'
    })

    ;(globalThis as {Deno?: unknown}).Deno = {version: {deno: 'test'}}

    await expect(
      installDependencies(projectPath, 'flaky-wifi', noopLogger)
    ).rejects.toThrow()

    expect(runInstallMock).toHaveBeenCalledTimes(1)
    expect(
      await fsp.readFile(path.join(projectPath, 'deno.jsonc'), 'utf8')
    ).toBe(authored)
  })

  it('does not rewrite when a different package is the missing version', async () => {
    const authored = `{
  "imports": {
    "react": "npm:react@99.0.0",
    "extension": "npm:extension@4.0.5-canary.1"
  },
  "nodeModulesDir": "auto"
}
`
    await fsp.writeFile(path.join(projectPath, 'deno.jsonc'), authored)

    runInstallMock.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr:
        "error: Could not find version of npm package 'react' matching '99.0.0'"
    })

    ;(globalThis as {Deno?: unknown}).Deno = {version: {deno: 'test'}}

    await expect(
      installDependencies(projectPath, 'other-pkg', noopLogger)
    ).rejects.toThrow()

    expect(runInstallMock).toHaveBeenCalledTimes(1)
    expect(
      await fsp.readFile(path.join(projectPath, 'deno.jsonc'), 'utf8')
    ).toBe(authored)
  })
})
