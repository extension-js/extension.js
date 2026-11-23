import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {parseJsoncSafe, readDenoConfigDependencies} from '../deno-manifest'

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

// Node's parse message quotes the start of the file, and the scaffold relays
// the error, so it names the place in the file as the author wrote it.
describe('parseJsoncSafe on text that is not JSON', () => {
  it('throws the line and column and quotes none of the text', () => {
    const secret = 'root:x:0:0:secret-hunter2'
    let message = ''

    try {
      parseJsoncSafe(secret)
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toBe('unexpected character at line 1 column 1')

    for (let i = 0; i + 4 <= secret.length; i++) {
      expect(message).not.toContain(secret.slice(i, i + 4))
    }
  })

  it('counts comments and trailing commas before the fault in its place', () => {
    const text =
      '{\n  /* a\n  block */ "a": [1, 2,],\n  // line\n  "b": 1\n  "c": 2\n}'

    expect(() => parseJsoncSafe(text)).toThrow(
      'unexpected character at line 6 column 3'
    )
  })

  it('still reads comments, trailing commas and an empty file', () => {
    expect(parseJsoncSafe('{"a": [1,], /* x */ "b": 2, // y\n}')).toEqual({
      a: [1],
      b: 2
    })

    expect(parseJsoncSafe('  \n')).toEqual({})
  })
})
