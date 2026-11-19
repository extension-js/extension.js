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
import {CODES} from '../messaging'
import {
  detectInvokedCommand,
  KNOWN_COMMANDS,
  telemetryExitCode,
  telemetryFailureCode
} from '../telemetry-cli'

// The allowlist is what keeps a project path out of the payload, so it cannot
// be derived at runtime. This registers every command the entry registers and
// reads the names Commander holds, so a name kept in a constant counts too.
function registeredCommands(): string[] {
  const program = new Command()

  for (const register of [
    registerCreateCommand,
    registerDevCommand,
    registerStartCommand,
    registerPreviewCommand,
    registerBuildCommand,
    registerLogsCommand,
    registerActCommands,
    registerPublishCommand,
    registerSafariCommand,
    registerInstallCommand,
    registerTelemetryCommand,
    registerDoctorCommand,
    registerCapabilitiesCommand
  ]) {
    register(program)
  }

  return program.commands.map((command) => command.name()).sort()
}

describe('telemetry command coverage', () => {
  it('finds the registered commands to compare against', () => {
    const registered = registeredCommands()
    expect(registered.length).toBeGreaterThan(10)
    expect(registered).toContain('dev')
    expect(registered).toContain('build')
    expect(registered).toContain('safari')
  })

  it('carries every registered command, so none reports as unknown', () => {
    const missing = registeredCommands().filter(
      (command) => !KNOWN_COMMANDS.has(command as never)
    )
    expect(missing).toEqual([])
  })

  it('lists nothing the CLI does not register, apart from the unknown bucket', () => {
    const registered = new Set(registeredCommands())
    const extra = [...KNOWN_COMMANDS].filter(
      (command) => command !== 'unknown' && !registered.has(command)
    )
    expect(extra).toEqual([])
  })

  it('reports a registered command by name and anything else as unknown', () => {
    for (const command of registeredCommands()) {
      expect(detectInvokedCommand(['node', 'extension', command])).toBe(command)
    }

    expect(detectInvokedCommand(['node', 'extension', './my-project'])).toBe(
      'unknown'
    )

    expect(detectInvokedCommand(['node', 'extension'])).toBe('unknown')
    expect(
      detectInvokedCommand(['node', 'extension', '--browser', 'chrome', 'dev'])
    ).toBe('unknown')
  })

  it('skips the value of a flag that takes one once the flags are known', () => {
    const valued = new Set(['--browser', '--output', '--format'])

    expect(
      detectInvokedCommand(
        ['node', 'extension', '--browser', 'chrome', 'dev'],
        valued
      )
    ).toBe('dev')

    expect(
      detectInvokedCommand(
        ['node', 'extension', '--output=json', 'build'],
        valued
      )
    ).toBe('build')

    expect(
      detectInvokedCommand(
        ['node', 'extension', '--format', 'json', 'install', '--where'],
        valued
      )
    ).toBe('install')

    expect(
      detectInvokedCommand(
        ['node', 'extension', '--browser', 'chrome', './my-project'],
        valued
      )
    ).toBe('unknown')
  })
})

describe('failure payload scrubbing', () => {
  it('passes a catalog code through', () => {
    expect(telemetryFailureCode(CODES.E_ARGS)).toBe('E_ARGS')
    expect(telemetryFailureCode(CODES.E_INTERNAL)).toBe('E_INTERNAL')
  })

  it('drops anything that is not a catalog code, so no message travels', () => {
    expect(telemetryFailureCode('ENOENT')).toBeUndefined()
    expect(
      telemetryFailureCode('/Users/someone/secret-project/manifest.json')
    ).toBeUndefined()

    expect(telemetryFailureCode(undefined)).toBeUndefined()
    expect(telemetryFailureCode(42)).toBeUndefined()
    expect(telemetryFailureCode('toString')).toBeUndefined()
  })

  it('keeps a real exit code and drops anything that is not one', () => {
    expect(telemetryExitCode(0)).toBe(0)
    expect(telemetryExitCode(1)).toBe(1)
    expect(telemetryExitCode(255)).toBe(255)
    expect(telemetryExitCode(256)).toBeUndefined()
    expect(telemetryExitCode(-1)).toBeUndefined()
    expect(telemetryExitCode(1.5)).toBeUndefined()
    expect(telemetryExitCode('1')).toBeUndefined()
    expect(telemetryExitCode(undefined)).toBeUndefined()
  })
})
