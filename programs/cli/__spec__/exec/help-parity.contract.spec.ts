import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import {programAIHelp, programUserHelp} from '../../cli-lib/messages'
import {registerCreateCommand} from '../../commands/create'
import {registerDevCommand} from '../../commands/dev'
import {registerStartCommand} from '../../commands/start'
import {registerPreviewCommand} from '../../commands/preview'
import {registerBuildCommand} from '../../commands/build'
import {registerInstallCommand} from '../../commands/install'

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
  const telemetry = {track: () => {}}
  const program = new Command()

  registerCreateCommand(program, telemetry)
  registerDevCommand(program, telemetry)
  registerStartCommand(program, telemetry)
  registerPreviewCommand(program, telemetry)
  registerBuildCommand(program, telemetry)
  registerInstallCommand(program, telemetry)

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
      'install',
      'preview',
      'start',
      'uninstall'
    ])
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
    expect(help).toContain('--format')
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
    expect(out).toContain('Source Inspection & Real-Time Monitoring')
  })

  it('contract #5: command --help output contains declared options', () => {
    const program = buildProgramForInspection()

    for (const command of program.commands) {
      const help = command.helpInformation()
      for (const option of command.options) {
        expect(help).toContain(option.long)
      }
    }
  })

  it('contract #6: source inspection capability is explicit and enforced for preview/start', () => {
    const topHelp = stripAnsi(programUserHelp())
    expect(topHelp).toContain(
      'extension preview and extension start do not run source inspection'
    )

    const previewResult = spawnSync(
      process.execPath,
      [cliBin(), 'preview', '--source', 'https://example.com'],
      {cwd: cliRoot(), encoding: 'utf8'}
    )
    const startResult = spawnSync(
      process.execPath,
      [cliBin(), 'start', '--source', 'https://example.com'],
      {cwd: cliRoot(), encoding: 'utf8'}
    )

    const previewOutput = stripAnsi(
      `${previewResult.stdout || ''}\n${previewResult.stderr || ''}`
    )
    const startOutput = stripAnsi(
      `${startResult.stdout || ''}\n${startResult.stderr || ''}`
    )

    expect(previewResult.status).toBe(1)
    expect(startResult.status).toBe(1)
    expect(previewOutput).toContain(
      'extension preview currently runs in run-only preview mode and does not support source inspection'
    )
    expect(startOutput).toContain(
      'extension start currently runs in run-only preview mode and does not support source inspection'
    )
  })

  it('contract #7: user help and ai-help remain aligned on source-inspection scope', () => {
    const userHelp = stripAnsi(programUserHelp())
    const aiHelp = stripAnsi(programAIHelp())

    expect(userHelp).toContain('Source Inspection (dev command)')
    expect(aiHelp).toContain(
      'Note: preview/start run in run-only mode and do not perform source inspection.'
    )
    expect(userHelp).not.toContain('extension cleanup')
  })

  it('contract #8: --ai-help supports machine-readable JSON output with a stable schema', () => {
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
    expect(output).toMatch(/extension\.js[\/\\]browsers/i)
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
    expect(output).toMatch(/extension\.js[\/\\]browsers/i)
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
    expect(output).toMatch(/extension\.js[\/\\]browsers[\/\\]firefox/i)
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
    expect(output).toMatch(/extension\.js[\/\\]browsers[\/\\]chrome/i)
    expect(output).toMatch(/extension\.js[\/\\]browsers[\/\\]edge/i)
    expect(output).toMatch(/extension\.js[\/\\]browsers[\/\\]firefox/i)
  })
})
