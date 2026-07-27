import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type {Argument} from 'commander'
import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import {registerActCommands} from '../../commands/act'
import {registerBuildCommand} from '../../commands/build'
import {registerCreateCommand} from '../../commands/create'
import {registerDevCommand} from '../../commands/dev'
import {registerDoctorCommand} from '../../commands/doctor'
import {registerInstallCommand} from '../../commands/install'
import {registerLogsCommand} from '../../commands/logs'
import {registerPreviewCommand} from '../../commands/preview'
import {registerPublishCommand} from '../../commands/publish'
import {registerStartCommand} from '../../commands/start'
import {registerTelemetryCommand} from '../../commands/telemetry'
import {
  COMMANDS,
  type CommandName,
  commandSpec,
  programUserHelp,
  registeredArgSignature
} from '../../helpers/messages'

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '')
}

function cliRoot(): string {
  return path.resolve(__dirname, '../..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs
  return path.join(cliRoot(), 'dist', 'cli.js')
}

function buildProgramForInspection() {
  const program = new Command()

  registerCreateCommand(program)
  registerDevCommand(program)
  registerStartCommand(program)
  registerPreviewCommand(program)
  registerBuildCommand(program)
  registerLogsCommand(program)
  registerActCommands(program)
  registerPublishCommand(program)
  registerInstallCommand(program)
  registerTelemetryCommand(program)
  registerDoctorCommand(program)

  return program
}

function extractAvailableCommandsFromTopHelp(help: string): string[] {
  const clean = stripAnsi(help)
  const section = clean
    .split('Available Commands')[1]
    ?.split('Common Options')[0]
    ?.trim()

  if (!section) return []

  const commands = Array.from(
    section.matchAll(/^\s*-\s*extension\s+([a-z-]+)\b/gm),
    (match) => match[1]
  )

  return Array.from(new Set(commands)).sort()
}

describe('CLI help parity contract', () => {
  it('contract #1: top-level command list matches registered commands', () => {
    const helpCommands = extractAvailableCommandsFromTopHelp(programUserHelp())
    const registeredCommands = buildProgramForInspection()
      .commands.map((cmd) => cmd.name())
      .sort()

    expect(helpCommands).toEqual(registeredCommands)
    expect(helpCommands).toEqual([
      'build',
      'create',
      'dev',
      'doctor',
      'eval',
      'inspect',
      'install',
      'logs',
      'open',
      'preview',
      'publish',
      'reload',
      'start',
      'storage',
      'telemetry',
      'uninstall'
    ])
  })

  it('contract #13: COMMANDS matches every registered argument signature', () => {
    const registered = buildProgramForInspection().commands

    expect(registered.map((command) => command.name()).sort()).toEqual(
      COMMANDS.map((spec) => spec.name)
        .slice()
        .sort()
    )

    for (const command of registered) {
      const spec = commandSpec(command.name() as CommandName)
      // Commander 15 exposes the parsed positionals, so the table can be
      // compared against the registration instead of against another copy.
      const actual = (command.registeredArguments as Argument[])
        .map((argument) =>
          argument.required ? `<${argument.name()}>` : `[${argument.name()}]`
        )
        .join(' ')

      expect(`${command.name()} ${actual}`.trim()).toBe(
        `${spec.name} ${registeredArgSignature(spec.positionals)}`.trim()
      )
      expect(command.description()).toBe(spec.description)
    }
  })

  it('contract #14: the help block prints the generated signature', () => {
    const help = stripAnsi(programUserHelp())

    for (const spec of COMMANDS) {
      expect(help).toContain(`- extension ${spec.name} ${spec.args}`)
      expect(help).toContain(`  ${spec.description}`)
    }
  })

  it('contract #15: help labels and value sets are declared, not improvised', () => {
    const relabelled = COMMANDS.flatMap((spec) =>
      spec.positionals
        .filter((positional) => positional.label)
        .map(
          (positional) => `${spec.name}:${positional.name}->${positional.label}`
        )
    )

    // Frozen list: these two register a name that does not describe what they
    // accept. A third one must be fixed at the registration, not relabelled.
    expect(relabelled).toEqual([
      'preview:project-name->project-path|remote-url',
      'build:project-name->project-path|remote-url'
    ])

    // Mirrors the surface allowlist the open handler enforces in act.ts.
    expect(commandSpec('open').positionals[0].values).toEqual([
      'popup',
      'options',
      'sidebar',
      'action',
      'command'
    ])
    expect(commandSpec('storage').positionals[0].values).toEqual(['get', 'set'])
  })

  it('contract #2: top-level defaults match runtime defaults', () => {
    const help = stripAnsi(programUserHelp())

    expect(help).toContain('(default: chromium)')
    expect(help).toContain('Minimum level (default: off)')
  })

  it('contract #3: top-level help documents global options', () => {
    const help = stripAnsi(programUserHelp())

    expect(help).toContain('--no-telemetry')
    expect(help).toContain('--ai-help')
    // --output is the canonical result-format flag; --format and --wait-format
    // survive only as documented deprecated aliases.
    expect(help).toContain('--output')
    expect(help).toContain(
      '--format and --wait-format still work as deprecated aliases of --output'
    )
    expect(help).toContain('--help')
  })

  it('contract #4: --ai-help exits with code 0 and prints canonical sections', () => {
    const result = spawnSync(process.execPath, [cliBin(), '--ai-help'], {
      cwd: cliRoot(),
      encoding: 'utf8'
    })

    const out = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`)
    expect(result.status).toBe(0)
    expect(out).toContain(
      'Development tips for extension developers and AI assistants'
    )
    expect(out).toContain('Managed Dependencies (Important)')
  })

  it('contract #5: command --help output contains declared options', () => {
    const program = buildProgramForInspection()

    for (const command of program.commands) {
      const help = command.helpInformation()
      // Only visible options: commander renders help through visibleOptions(),
      // so a deliberately hidden alias is absent by design, not by drift.
      for (const option of command.options) {
        if (option.hidden) continue
        expect(help).toContain(option.long)
      }
    }
  })

  it('contract #8: --ai-help supports machine-readable JSON output with a stable schema', () => {
    // Spawns with the deprecated --format alias on purpose: it must keep
    // resolving to --output json, with the notice on stderr, not stdout.
    const result = spawnSync(
      process.execPath,
      [cliBin(), '--ai-help', '--format', 'json'],
      {
        cwd: cliRoot(),
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(0)

    const parsed = JSON.parse(result.stdout || '{}') as {
      version?: unknown
      commands?: unknown
      globalOptions?: unknown
      capabilities?: unknown
      examples?: unknown
    }

    expect(typeof parsed.version).toBe('string')
    expect(Array.isArray(parsed.commands)).toBe(true)
    expect(Array.isArray(parsed.globalOptions)).toBe(true)
    expect(parsed.capabilities).toBeTruthy()
    expect(Array.isArray(parsed.examples)).toBe(true)
  })

  it('contract #9: install --where prints managed cache path and exits 0', () => {
    const result = spawnSync(
      process.execPath,
      [cliBin(), 'install', '--where'],
      {
        cwd: cliRoot(),
        encoding: 'utf8'
      }
    )

    const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`)
    expect(result.status).toBe(0)
    expect(output).toMatch(/extension\.js[/\\]browsers/i)
  })

  it('contract #10: uninstall --where prints managed cache path and exits 0', () => {
    const result = spawnSync(
      process.execPath,
      [cliBin(), 'uninstall', '--where'],
      {
        cwd: cliRoot(),
        encoding: 'utf8'
      }
    )

    const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`)
    expect(result.status).toBe(0)
    expect(output).toMatch(/extension\.js[/\\]browsers/i)
  })

  it('contract #11: install --where with --browser prints browser-specific path', () => {
    const result = spawnSync(
      process.execPath,
      [cliBin(), 'install', '--where', '--browser=firefox'],
      {
        cwd: cliRoot(),
        encoding: 'utf8'
      }
    )

    const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`)
    expect(result.status).toBe(0)
    expect(output).toMatch(/extension\.js[/\\]browsers[/\\]firefox/i)
  })

  it('contract #12: uninstall --where --all prints browser-specific paths', () => {
    const result = spawnSync(
      process.execPath,
      [cliBin(), 'uninstall', '--where', '--all'],
      {
        cwd: cliRoot(),
        encoding: 'utf8'
      }
    )

    const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`)
    expect(result.status).toBe(0)
    expect(output).toMatch(/extension\.js[/\\]browsers[/\\]chrome/i)
    expect(output).toMatch(/extension\.js[/\\]browsers[/\\]edge/i)
    expect(output).toMatch(/extension\.js[/\\]browsers[/\\]firefox/i)
  })
})
