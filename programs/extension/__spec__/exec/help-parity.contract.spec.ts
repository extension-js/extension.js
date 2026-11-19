import path from 'node:path'
import type {Argument} from 'commander'
import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import {registerActCommands} from '../../commands/act'
import {registerBuildCommand} from '../../commands/build'
import {registerCapabilitiesCommand} from '../../commands/capabilities'
import {registerCreateCommand} from '../../commands/create'
import {registerDevCommand} from '../../commands/dev'
import {registerDoctorCommand} from '../../commands/doctor'
import {registerInstallCommand} from '../../commands/install'
import {registerLogsCommand} from '../../commands/logs'
import {registerPreviewCommand} from '../../commands/preview'
import {registerPublishCommand} from '../../commands/publish'
import {registerSafariCommand} from '../../commands/safari'
import {registerStartCommand} from '../../commands/start'
import {registerTelemetryCommand} from '../../commands/telemetry'
import {
  COMMANDS,
  type CommandName,
  commandSpec,
  programUserHelp,
  registeredArgSignature
} from '../../helpers/messages'
import {cliHome, runCli, stripAnsi} from '../helpers/run-cli'

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
  registerSafariCommand(program)
  registerInstallCommand(program)
  registerTelemetryCommand(program)
  registerDoctorCommand(program)
  registerCapabilitiesCommand(program)

  return program
}

function extractAvailableCommandsFromTopHelp(help: string): string[] {
  const clean = stripAnsi(help)
  const section = clean
    .split('Available commands')[1]
    ?.split('Common options')[0]
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
      'capabilities',
      'create',
      'dev',
      'doctor',
      'eval',
      'inspect',
      'install',
      'logs',
      'navigate',
      'open',
      'preview',
      'publish',
      'reload',
      'safari',
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
        .map((argument) => {
          const token = `${argument.name()}${argument.variadic ? '...' : ''}`

          return argument.required ? `<${token}>` : `[${token}]`
        })
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
      expect(help).toContain(`- extension ${spec.name} ${spec.args}`.trimEnd())
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

  it('contract #16: install help names the browser a bare install picks', async () => {
    const install = buildProgramForInspection().commands.find(
      (command) => command.name() === 'install'
    ) as Command

    expect(stripAnsi(install.helpInformation())).toMatch(
      /browser-name\s+managed browser to install \(default: chromium\)/
    )

    const spawned = await runCli(['install', '--help'])

    expect(spawned.status).toBe(0)
    expect(spawned.stdout).toMatch(
      /browser-name\s+managed browser to install \(default: chromium\)/
    )

    expect(stripAnsi(programUserHelp())).toContain(
      'Defaults to chromium when no browser is named.'
    )
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

  it('contract #4: --ai-help exits with code 0 and prints canonical sections', async () => {
    const result = await runCli(['--ai-help'])
    const out = result.output
    expect(result.status).toBe(0)
    expect(out).toContain(
      'Development tips for extension developers and AI assistants'
    )

    expect(out).toContain('Managed dependencies (important)')
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

  it('contract #8: --ai-help supports machine-readable JSON output with a stable schema', async () => {
    // Spawns with the deprecated --format alias on purpose: it must keep
    // resolving to --output json, with the notice on stderr, not stdout.
    const result = await runCli(['--ai-help', '--format', 'json'])

    expect(result.status).toBe(0)

    const parsed = JSON.parse(result.stdout) as {
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

  // The cache root is the helper's temp folder, so no case reads this
  // machine's own cache and each answer can be compared whole.
  it.each([
    ['contract #9', 'install'],
    ['contract #10', 'uninstall']
  ])('%s: %s --where prints the managed cache root and exits 0', async (_id, command) => {
    const result = await runCli([command, '--where'])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(`${cliHome().browsersCache}\n`)
  })

  it('contract #9b: with no override the root sits under the user cache folder', async () => {
    const result = await runCli(['install', '--where'], {
      env: {EXT_BROWSERS_CACHE_DIR: undefined}
    })
    const home = cliHome()
    const root =
      process.platform === 'win32'
        ? path.join(home.home, 'AppData', 'Local')
        : process.platform === 'darwin'
          ? path.join(home.home, 'Library', 'Caches')
          : home.cacheHome

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      `${path.join(root, 'extension.js', 'browsers')}\n`
    )
  })

  it('contract #11: install --where with --browser prints browser-specific path', async () => {
    const result = await runCli(['install', '--where', '--browser=firefox'])

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      `${path.join(cliHome().browsersCache, 'firefox')}\n`
    )
  })

  it('contract #12: uninstall --where --all prints browser-specific paths', async () => {
    const result = await runCli(['uninstall', '--where', '--all'])
    const root = cliHome().browsersCache

    expect(result.status).toBe(0)
    expect(result.stdout.trimEnd().split('\n')).toEqual(
      ['chrome', 'chromium', 'edge', 'firefox'].map((name) =>
        path.join(root, name)
      )
    )
  })
})
