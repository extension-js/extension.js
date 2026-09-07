import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {CODES} from '../messaging'
import {
  detectInvokedCommand,
  KNOWN_COMMANDS,
  telemetryExitCode,
  telemetryFailureCode
} from '../telemetry-cli'

// The allowlist is what keeps a project path out of the payload, so it cannot
// be derived at runtime. This reads the registrations instead and fails when a
// new command lands without one, which is what left half of the failures under
// 'unknown'.
function registeredCommands(): string[] {
  const dir = path.join(__dirname, '..', '..', 'commands')
  const found = new Set<string>()

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue
    const source = fs.readFileSync(path.join(dir, entry), 'utf-8')
    const pattern = /\.command\(\s*'([a-z][a-z-]*)'/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source))) found.add(match[1])
  }

  return [...found].sort()
}

describe('telemetry command coverage', () => {
  it('finds the registered commands to compare against', () => {
    const registered = registeredCommands()
    expect(registered.length).toBeGreaterThan(10)
    expect(registered).toContain('dev')
    expect(registered).toContain('build')
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
