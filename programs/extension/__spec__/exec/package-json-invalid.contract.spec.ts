import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {framesIn, runCli as spawnCli} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string} | null
}

// Debug off: a debug run prints the stack on purpose.
function runCli(args: string[]) {
  return spawnCli(args, {env: {EXTENSION_DEBUG: '0'}})
}

// A package.json no tool can parse is the author's file to fix, so every
// command that resolves the project answers with one code and the path.
describe('a package.json that is not JSON', () => {
  let work = ''
  let projectDir = ''

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'extjs-package-json-'))
    projectDir = join(work, 'project')
    mkdirSync(projectDir, {recursive: true})
    writeFileSync(join(projectDir, 'package.json'), '{"name": "cut-short",')
    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Cut Short',
        version: '1.0.0',
        background: {service_worker: 'background.js'}
      })
    )

    writeFileSync(join(projectDir, 'background.js'), 'console.log("bg")\n')
  })

  afterAll(() => {
    rmSync(work, {recursive: true, force: true})
  })

  const commands: Array<[string, string[]]> = [
    ['dev', ['--no-browser']],
    ['build', []],
    ['start', ['--no-browser']],
    ['preview', ['--no-browser']]
  ]

  it.each(
    commands
  )('answers %s --output json with one E_PACKAGE_JSON_INVALID frame', async (command, flags) => {
    const run = await runCli([
      command,
      projectDir,
      ...flags,
      '--output',
      'json'
    ])
    const emitted = framesIn<Frame>(run.stdout)

    expect(run.status).toBe(1)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].ok).toBe(false)
    expect(emitted[0].command).toBe(command)
    expect(emitted[0].error?.code).toBe('E_PACKAGE_JSON_INVALID')

    const message = String(emitted[0].error?.message)

    expect(message).toContain("Couldn't read package.json as JSON")
    expect(message).toContain(join(projectDir, 'package.json'))
    expect(message).not.toContain('⏵')
    expect(message).not.toMatch(/\n\s+at /)
    expect(run.stderr).not.toContain('Invalid package.json at')
  })
})
