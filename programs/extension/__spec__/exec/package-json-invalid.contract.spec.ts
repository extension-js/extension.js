import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
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

  // One reader works on all four: the project is not usable, so the run
  // failed, with the same keys and a hint that names the command.
  it.each(
    commands
  )('gives the %s frame the status, keys and hint every command gives', async (command, flags) => {
    const run = await runCli([
      command,
      projectDir,
      ...flags,
      '--output',
      'json'
    ])
    const [frame] = framesIn<Record<string, unknown>>(run.stdout)

    expect(frame.status).toBe(
      command === 'build' || command === 'start' ? 'build-failed' : 'failed'
    )

    expect(Object.keys(frame).sort()).toEqual([
      'command',
      'error',
      'hint',
      'ok',
      'schema',
      'status',
      'value',
      'warnings'
    ])

    expect(Object.keys(frame.error as object).sort()).toEqual([
      'code',
      'message'
    ])

    expect(frame.hint).toBe(`Fix the error above and run ${command} again.`)
  })

  // doctor reads the dependencies from the same file, and a pass there
  // would say every dependency was checked when none could be read.
  it('fails the doctor check that reads package.json, and names the file', async () => {
    const run = await runCli(['doctor', projectDir, '--output', 'json'])
    const [frame] = framesIn<{
      value: Array<{
        check: string
        status: string
        detail: string
        remediation?: string
      }>
    }>(run.stdout)
    const check = frame.value.find((each) => each.check === 'peer-rspack')

    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain(
      `${join(projectDir, 'package.json')} cannot be read as JSON`
    )

    expect(check?.remediation).toBe('Fix package.json, then run doctor again')
  })
})

// Node's parse message quotes the start of the file, so an agent pointed at a
// folder whose package.json links to another file relayed that file.
const SECRET = 'root:x:0:0:secret-hunter2'
const SECRET_SLICES = Array.from({length: SECRET.length - 3}, (_, i) =>
  SECRET.slice(i, i + 4)
)

function expectNoSecret(text: string) {
  for (const slice of SECRET_SLICES) expect(text).not.toContain(slice)
}

// Windows needs a privilege to make a file link, so the linked row runs where
// the platform lets an ordinary user make one.
function canLink(dir: string): boolean {
  try {
    writeFileSync(join(dir, 'link-target'), '')
    symlinkSync(join(dir, 'link-target'), join(dir, 'link-probe'))

    return true
  } catch {
    return false
  }
}

describe('a package.json whose text is not JSON is described by position only', () => {
  let work = ''
  const layouts: Array<[string, string]> = []

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'extjs-pkg-leak-'))

    const plain = join(work, 'plain')
    mkdirSync(plain)
    writeFileSync(join(plain, 'package.json'), SECRET)
    layouts.push(['a file', plain])

    if (canLink(work)) {
      const linked = join(work, 'linked')
      mkdirSync(linked)
      writeFileSync(join(work, 'outside.txt'), `${SECRET}\n`)
      symlinkSync(join(work, 'outside.txt'), join(linked, 'package.json'))
      layouts.push(['a link to another file', linked])
    }

    for (const [, dir] of layouts) {
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({manifest_version: 3, name: 'Leak', version: '1.0.0'})
      )
    }
  })

  afterAll(() => {
    rmSync(work, {recursive: true, force: true})
  })

  it('runs the linked row where the platform allows links', () => {
    expect(layouts.length).toBe(process.platform === 'win32' ? 1 : 2)
  })

  for (const index of [0, 1]) {
    it(`names the line and column for package.json as layout ${index} in doctor --output json`, async () => {
      if (!layouts[index]) return

      const [, dir] = layouts[index]
      const run = await runCli(['doctor', dir, '--output', 'json'])
      const [frame] = framesIn<{value: Array<{check: string; detail: string}>}>(
        run.stdout
      )
      const check = frame.value.find((each) => each.check === 'peer-rspack')

      expect(check?.detail).toBe(
        `${join(dir, 'package.json')} cannot be read as JSON (unexpected character at line 1 column 1), so no dependency was checked`
      )

      expectNoSecret(run.stdout + run.stderr)
    })

    it(`names the line and column for package.json as layout ${index} in doctor text`, async () => {
      if (!layouts[index]) return

      const [, dir] = layouts[index]
      const run = await runCli(['doctor', dir])

      expect(run.stdout + run.stderr).toContain(
        'unexpected character at line 1 column 1'
      )

      expectNoSecret(run.stdout + run.stderr)
    })

    it(`names the line and column for package.json as layout ${index} in build --output json`, async () => {
      if (!layouts[index]) return

      const [, dir] = layouts[index]
      const run = await runCli(['build', dir, '--output', 'json'])
      const [frame] = framesIn<Frame>(run.stdout)

      expect(frame.error?.code).toBe('E_PACKAGE_JSON_INVALID')
      expect(frame.error?.message).toContain(
        'unexpected character at line 1 column 1'
      )

      expectNoSecret(run.stdout + run.stderr)
    })
  }
})

// Posix only: Windows has no mode bits that keep the owner from reading,
// and the superuser reads past them.
const modeBitsKeepReadersOut =
  process.platform !== 'win32' && process.getuid?.() !== 0

// A package.json that is there and cannot be opened is the same unusable
// project as one that does not parse.
describe.skipIf(!modeBitsKeepReadersOut)(
  'a project whose package.json cannot be opened',
  () => {
    let work = ''
    let projectDir = ''

    beforeAll(() => {
      work = mkdtempSync(join(tmpdir(), 'extjs-package-json-unopened-'))
      projectDir = join(work, 'project')
      mkdirSync(projectDir, {recursive: true})
      writeFileSync(join(projectDir, 'package.json'), '{"name": "unopened"}')
      chmodSync(join(projectDir, 'package.json'), 0o000)
      writeFileSync(
        join(projectDir, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Unopened',
          version: '1.0.0'
        })
      )
    })

    afterAll(() => {
      chmodSync(join(projectDir, 'package.json'), 0o644)
      rmSync(work, {recursive: true, force: true})
    })

    it.each([
      ['dev', ['--no-browser'], 'failed'],
      ['build', [], 'build-failed'],
      ['start', ['--no-browser'], 'build-failed'],
      ['preview', ['--no-browser'], 'failed']
    ] as const)('answers %s --output json with one E_PACKAGE_JSON_INVALID frame', async (command, flags, status) => {
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
      expect(emitted[0].status).toBe(status)
      expect(emitted[0].error?.code).toBe('E_PACKAGE_JSON_INVALID')
      expect(String(emitted[0].error?.message)).toContain(
        "Couldn't open package.json."
      )
    })

    it('fails the doctor check that reads package.json', async () => {
      const run = await runCli(['doctor', projectDir, '--output', 'json'])
      const [frame] = framesIn<{
        value: Array<{check: string; status: string}>
      }>(run.stdout)

      expect(
        frame.value.find((each) => each.check === 'peer-rspack')?.status
      ).toBe('fail')
    })
  }
)

// A folder under the name is skipped by the walk, so the bundler used to
// meet it first and answer with its own read error.
describe('a project whose package.json is a folder', () => {
  let work = ''
  let projectDir = ''

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'extjs-package-json-folder-'))
    projectDir = join(work, 'project')
    mkdirSync(join(projectDir, 'package.json'), {recursive: true})
    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'Folder', version: '1.0.0'})
    )
  })

  afterAll(() => {
    rmSync(work, {recursive: true, force: true})
  })

  it.each([
    ['dev', ['--no-browser'], 'failed'],
    ['build', [], 'build-failed'],
    ['start', ['--no-browser'], 'build-failed'],
    ['preview', ['--no-browser'], 'failed']
  ] as const)('answers %s --output json with one E_PACKAGE_JSON_INVALID frame that says a folder was found', async (command, flags, status) => {
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
    expect(emitted[0].status).toBe(status)
    expect(emitted[0].error?.code).toBe('E_PACKAGE_JSON_INVALID')
    expect(String(emitted[0].error?.message)).toContain(
      'package.json is a folder, not a file.'
    )
  })

  it('fails the doctor check that reads package.json', async () => {
    const run = await runCli(['doctor', projectDir, '--output', 'json'])
    const [frame] = framesIn<{
      value: Array<{check: string; status: string; detail?: string}>
    }>(run.stdout)
    const check = frame.value.find((each) => each.check === 'peer-rspack')

    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('is a folder, not a file')
  })
})
