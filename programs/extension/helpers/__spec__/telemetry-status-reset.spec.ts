import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  blockFolder,
  cliRun,
  fsWith,
  readRows,
  type Sandbox,
  useTelemetrySandbox
} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

const NOTHING_STORED = {anonymousId: null, consentFile: null, auditFile: null}

// A first run on an empty machine: the notice prints and one row is audited.
function firstRun(box: Sandbox) {
  const run = cliRun(box)

  run.cli.start()
  run.cli.markCommandFailure('build', {code: 'E_ARGS'})

  return run
}

function filesIn(folder: string): string[] {
  return fs.existsSync(folder) ? fs.readdirSync(folder).sort() : []
}

describe('reading the telemetry status', () => {
  it('names the stored ID and both files after a first run', () => {
    const box = sandbox()

    firstRun(box)

    const id = fs.readFileSync(path.join(box.configDir, 'anonymous-id'), 'utf8')

    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(cliRun(box).cli.getStatus()).toEqual({
      enabled: true,
      source: 'config',
      anonymousId: id,
      consentFile: path.join(box.configDir, 'consent'),
      auditFile: path.join(box.configDir, 'events.jsonl')
    })
  })

  it('shows the ID a worktree run sends, not the one stored in the clone', () => {
    const box = sandbox()
    fs.mkdirSync(path.join(box.root, '.git'))

    const run = firstRun(box)
    const stored = fs.readFileSync(
      path.join(box.configDir, 'anonymous-id'),
      'utf8'
    )
    const sent = readRows(path.join(box.configDir, 'events.jsonl'))[0]

    expect(run.cli.getStatus().anonymousId).toBe(sent.distinct_id)
    expect(run.cli.getStatus().anonymousId).not.toBe(stored)
  })

  it.each([
    ['EXTENSION_TELEMETRY_DISABLED', '1'],
    ['EXTENSION_TELEMETRY', '0'],
    ['DO_NOT_TRACK', '1']
  ])('names %s as what turned it off and creates nothing', (name, value) => {
    const box = sandbox({env: {[name]: value}})

    expect(cliRun(box).cli.getStatus()).toEqual({
      enabled: false,
      source: 'env',
      variable: name,
      ...NOTHING_STORED
    })

    expect(fs.existsSync(box.places.config)).toBe(false)
    expect(fs.existsSync(box.places.cache)).toBe(false)
    expect(filesIn(box.places.tmp)).toEqual([])
  })

  it('still names what is stored while a variable keeps it off', () => {
    const box = sandbox()

    firstRun(box)
    box.deps.env = {...box.deps.env, DO_NOT_TRACK: '1'}

    const before = filesIn(box.configDir)
    const status = cliRun(box).cli.getStatus()

    expect(status).toMatchObject({
      enabled: false,
      source: 'env',
      variable: 'DO_NOT_TRACK',
      consentFile: path.join(box.configDir, 'consent')
    })

    expect(status.anonymousId).toMatch(/^[0-9a-f-]{36}$/)
    expect(filesIn(box.configDir)).toEqual(before)
  })

  it('reads the fallback folder when the config home is a file', () => {
    const box = sandbox()
    blockFolder(box.places.config)

    firstRun(box)

    expect(cliRun(box).cli.getStatus().auditFile).toBe(
      path.join(box.cacheDir, 'events.jsonl')
    )
  })
})

describe('resetting telemetry', () => {
  it('removes the ID, the consent, the notice marker and the audit log', () => {
    const box = sandbox()

    firstRun(box)
    fs.writeFileSync(path.join(box.configDir, 'events.jsonl.1'), '{}\n')

    expect(filesIn(box.configDir)).toEqual([
      'anonymous-id',
      'consent',
      'events.jsonl',
      'events.jsonl.1',
      'notice-shown'
    ])

    expect(cliRun(box).cli.reset()).toEqual({
      ok: true,
      removed: [
        'anonymous-id',
        'consent',
        'notice-shown',
        'events.jsonl',
        'events.jsonl.1'
      ].map((name) => path.join(box.configDir, name)),
      clearedOptOut: false
    })

    expect(filesIn(box.configDir)).toEqual([])
  })

  it('makes the next run a first run: a new ID and the notice again', () => {
    const box = sandbox()
    const first = firstRun(box)
    const firstId = first.cli.getStatus().anonymousId

    cliRun(box).cli.reset()

    const next = firstRun(box)

    expect(first.notices).toHaveLength(1)
    expect(next.notices).toHaveLength(1)
    expect(next.cli.getConsent()).toEqual({enabled: true, source: 'default'})
    expect(next.cli.getStatus().anonymousId).toMatch(/^[0-9a-f-]{36}$/)
    expect(next.cli.getStatus().anonymousId).not.toBe(firstId)
  })

  it('leaves nothing behind from the run that resets', async () => {
    const box = sandbox()

    firstRun(box)

    const run = cliRun(box, {argv: ['node', 'extension', 'telemetry', 'reset']})

    run.cli.start()
    run.cli.reset()
    run.cli.markCommandSuccess('telemetry')
    await run.hooks.beforeExit[0]()

    expect(filesIn(box.configDir)).toEqual([])
    expect(box.sent).toEqual([])
  })

  it('says when it removed a stored opt-out', () => {
    const box = sandbox()

    cliRun(box).cli.setConsent('disabled')

    const result = cliRun(box).cli.reset()

    expect(result).toMatchObject({ok: true, clearedOptOut: true})
    expect(result.removed).toContain(path.join(box.configDir, 'consent'))
    expect(filesIn(box.configDir)).toEqual([])
  })

  it('clears every folder a run may have used, not only the first', () => {
    const box = sandbox()

    firstRun(box)
    fs.mkdirSync(box.cacheDir, {recursive: true})
    fs.writeFileSync(path.join(box.cacheDir, 'anonymous-id'), 'older')

    expect(cliRun(box).cli.reset().removed).toContain(
      path.join(box.cacheDir, 'anonymous-id')
    )

    expect(filesIn(box.cacheDir)).toEqual([])
  })

  it('removes nothing and creates nothing on an empty machine', () => {
    const box = sandbox({env: {DO_NOT_TRACK: '1'}})

    expect(cliRun(box).cli.reset()).toEqual({
      ok: true,
      removed: [],
      clearedOptOut: false
    })

    expect(fs.existsSync(box.places.config)).toBe(false)
  })

  it('answers not ok when a file cannot be removed, and removes the rest', () => {
    const box = sandbox()

    firstRun(box)

    const stuck = path.join(box.configDir, 'consent')
    const run = cliRun(box, {
      fs: fsWith({
        rmSync: (file: string, options: fs.RmOptions) => {
          if (file === stuck) {
            throw Object.assign(new Error('EPERM'), {code: 'EPERM'})
          }

          fs.rmSync(file, options)
        }
      })
    })

    expect(run.cli.reset()).toMatchObject({ok: false, clearedOptOut: false})
    expect(filesIn(box.configDir)).toEqual(['consent'])
  })
})
