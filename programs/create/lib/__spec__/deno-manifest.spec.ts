import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {readDenoConfigDependencies} from '../deno-manifest'

describe('readDenoConfigDependencies', () => {
  let projectPath: string

  beforeEach(async () => {
    projectPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-deno-'))
  })

  afterEach(async () => {
    await fsp.rm(projectPath, {recursive: true, force: true})
  })

  it('reads npm specifiers from deno.json imports', async () => {
    await fsp.writeFile(
      path.join(projectPath, 'deno.json'),
      JSON.stringify({imports: {react: 'npm:react@^18.3.1'}})
    )

    expect(readDenoConfigDependencies(projectPath)).toEqual({
      react: '^18.3.1'
    })
  })

  it('reads deno.jsonc when it is the only config', async () => {
    await fsp.writeFile(
      path.join(projectPath, 'deno.jsonc'),
      '{\n  // deps\n  "imports": {"preact": "npm:preact@10.0.0"}\n}\n'
    )

    expect(readDenoConfigDependencies(projectPath)).toEqual({
      preact: '10.0.0'
    })
  })

  it('prefers deno.json over deno.jsonc, matching Deno discovery', async () => {
    await fsp.writeFile(
      path.join(projectPath, 'deno.json'),
      JSON.stringify({imports: {react: 'npm:react@^18.3.1'}})
    )
    await fsp.writeFile(
      path.join(projectPath, 'deno.jsonc'),
      JSON.stringify({imports: {preact: 'npm:preact@10.0.0'}})
    )

    // Deno reads exactly one config file, so the jsonc imports are invisible
    // to it and must be invisible here too.
    expect(readDenoConfigDependencies(projectPath)).toEqual({
      react: '^18.3.1'
    })
  })

  it('returns nothing when no config exists', async () => {
    expect(readDenoConfigDependencies(projectPath)).toEqual({})
  })
})
