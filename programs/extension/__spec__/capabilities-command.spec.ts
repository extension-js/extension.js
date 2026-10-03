import * as fs from 'node:fs'
import * as path from 'node:path'
import {Command} from 'commander'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {registerBuildCommand} from '../commands/build'
import {
  buildEngineCapabilities,
  collectOutputJsonCommands,
  collectRecordStreamCommands,
  READY_CONTRACT_SCHEMA_VERSION,
  registerCapabilitiesCommand
} from '../commands/capabilities'
import {registerDevCommand} from '../commands/dev'
import {registerDoctorCommand} from '../commands/doctor'
import {registerLogsCommand} from '../commands/logs'
import {runCli, stubProcessExit} from './command-harness'

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeFullProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerDevCommand(program)
  registerBuildCommand(program)
  registerLogsCommand(program)
  registerDoctorCommand(program)
  registerCapabilitiesCommand(program)

  return program
}

describe('collectOutputJsonCommands', () => {
  it('lists every registered command that accepts --output json', () => {
    expect(collectOutputJsonCommands(makeFullProgram())).toEqual([
      'build',
      'capabilities',
      'dev',
      'doctor',
      'logs'
    ])
  })

  // The field means "accepts --output json", as 4.1.30 and the docs read it,
  // so logs stays in it. The record-stream list is the additive distinction.
  it('names a record-stream command in both lists', () => {
    const program = makeFullProgram()
    const envelopeCommands = collectOutputJsonCommands(program)
    const recordStreamCommands = collectRecordStreamCommands(program)

    expect(recordStreamCommands).toEqual(['logs'])
    expect(envelopeCommands).toContain('logs')
  })

  it('lists exactly the commands whose --output option takes json', () => {
    const program = makeFullProgram()
    const accepted = (
      program.commands as unknown as Array<{
        name(): string
        options?: Array<{long?: string; flags?: string}>
      }>
    )
      .filter((command) =>
        (command.options || []).some(
          (option) =>
            option.long === '--output' &&
            String(option.flags || '').includes('json')
        )
      )
      .map((command) => command.name())
      .sort()

    expect(collectOutputJsonCommands(program)).toEqual(accepted)
  })

  it('excludes commands without an --output json option', () => {
    const program = new Command()
    program.exitOverride()
    program.command('plain').action(() => {})
    program
      .command('pretty-only')
      .option('--output <pretty>', 'pretty only')
      .action(() => {})

    registerCapabilitiesCommand(program)
    expect(collectOutputJsonCommands(program)).toEqual(['capabilities'])
  })
})

describe('buildEngineCapabilities', () => {
  it('reports the running artifact version and both contract versions', () => {
    const value = buildEngineCapabilities(makeFullProgram())
    expect(value.name).toBe('extension')
    expect(value.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(value.envelopeSchema).toBe(1)
    expect(value.readySchemaVersion).toBe(READY_CONTRACT_SCHEMA_VERSION)
  })

  it('agrees with the schemaVersion the engine writer stamps', () => {
    const writerSource = fs.readFileSync(
      path.resolve(__dirname, '../../develop/plugin-playwright/index.ts'),
      'utf8'
    )
    const stamped = writerSource.match(/schemaVersion:\s*(\d+)/)
    expect(Number(stamped?.[1])).toBe(READY_CONTRACT_SCHEMA_VERSION)
  })
})

describe('extension capabilities', () => {
  it('answers with one schema-1 envelope on stdout by default', async () => {
    const code = await runCli(makeFullProgram(), ['capabilities'])
    expect(code).toBe(0)
    expect(logSpy).toHaveBeenCalledTimes(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.schema).toBe(1)
    expect(frame.ok).toBe(true)
    expect(frame.command).toBe('capabilities')
    expect(frame.status).toBe('ok')
    expect(frame.error).toBeNull()
    expect(frame.value.envelopeSchema).toBe(1)
    expect(frame.value.readySchemaVersion).toBe(READY_CONTRACT_SCHEMA_VERSION)
    expect(frame.value.outputJsonCommands).toContain('dev')
    expect(frame.value.outputJsonCommands).toContain('build')
    expect(frame.value.outputJsonCommands).toContain('capabilities')
    expect(frame.value.outputJsonCommands).toContain('logs')
    expect(frame.value.recordStreamCommands).toEqual(['logs'])
  })

  it('keeps the same answer under an explicit --output json', async () => {
    const code = await runCli(makeFullProgram(), [
      'capabilities',
      '--output',
      'json'
    ])
    expect(code).toBe(0)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.schema).toBe(1)
    expect(frame.ok).toBe(true)
  })

  it('prints a readable summary under --output pretty', async () => {
    const code = await runCli(makeFullProgram(), [
      'capabilities',
      '--output',
      'pretty'
    ])
    expect(code).toBe(0)
    const out = String(logSpy.mock.calls[0][0])
    expect(() => JSON.parse(out)).toThrow()
    expect(out).toContain('envelope schema: 1')
    expect(out).toContain('--output json')
  })
})
