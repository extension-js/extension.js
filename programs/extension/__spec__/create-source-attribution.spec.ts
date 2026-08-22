import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.hoisted(() => {
  process.env.EXTENSION_TELEMETRY_DISABLED = '1'
})

vi.mock('extension-create', () => ({
  extensionCreate: vi.fn(async () => {}),
  // The catalog builds its alias listing from this table at import time, so a
  // mock without it fails the whole file before a single test runs.
  TEMPLATE_ALIASES: {},
  resolveTemplateAlias: (name: string) => name
}))
vi.mock('../helpers/extension-develop-runtime', () => ({
  resolveExtensionDevelopRoot: vi.fn(() => '/resolved/develop/root')
}))
vi.mock('../helpers/cli-package-json', () => ({
  getCliPackageJson: vi.fn(() => ({version: '9.9.9'}))
}))

import type {Command} from 'commander'
import {registerCreateCommand} from '../commands/create'
import {telemetryCommandContext} from '../helpers/telemetry-cli'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const savedRoot = process.env.EXTENSION_CREATE_DEVELOP_ROOT

beforeEach(() => {
  stubProcessExit()
  delete process.env.EXTENSION_CREATE_DEVELOP_ROOT
})

afterEach(() => {
  if (savedRoot === undefined) delete process.env.EXTENSION_CREATE_DEVELOP_ROOT
  else process.env.EXTENSION_CREATE_DEVELOP_ROOT = savedRoot
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function createCommand(): Command {
  const program = makeProgram(registerCreateCommand)
  const command = program.commands.find((each) => each.name() === 'create')
  if (!command) throw new Error('create command is not registered')
  return command
}

function argv(...args: string[]): string[] {
  return ['/node', '/extension', ...args]
}

describe('the create command declares --source', () => {
  it('registers the flag so a gallery command is not refused', () => {
    const flags = createCommand()
      .options.map((option) => option.long)
      .filter(Boolean)
    expect(flags).toContain('--source')
  })

  it('accepts both the space form and the equals form without erroring', async () => {
    expect(
      await runCli(makeProgram(registerCreateCommand), [
        'create',
        'my-extension',
        '--source',
        'templates'
      ])
    ).toBe(0)
    expect(
      await runCli(makeProgram(registerCreateCommand), [
        'create',
        'my-extension',
        '--source=templates'
      ])
    ).toBe(0)
  })
})

describe('the declared --source reaches the telemetry payload', () => {
  it('carries the tag the gallery emits, in the space form', () => {
    expect(
      telemetryCommandContext(
        'create',
        argv(
          'create',
          'my-extension',
          '--template',
          'content',
          '--source',
          'templates'
        )
      )
    ).toEqual({template: 'content', source: 'templates'})
  })

  it('carries the tag in the equals form', () => {
    expect(
      telemetryCommandContext(
        'create',
        argv(
          'create',
          'my-extension',
          '--template=content',
          '--source=templates'
        )
      )
    ).toEqual({template: 'content', source: 'templates'})
  })

  it('falls back to cli when no surface claims the create', () => {
    expect(
      telemetryCommandContext('create', argv('create', 'my-extension'))
    ).toEqual({template: undefined, source: 'cli'})
  })

  it('attributes nothing on a command that has no front door', () => {
    expect(
      telemetryCommandContext('build', argv('build', '--source', 'templates'))
    ).toEqual({})
  })
})

describe('the two halves stay joined', () => {
  it('reads the same tag through the declared flag and through argv', async () => {
    const declared = createCommand()
      .options.map((option) => option.long)
      .filter(Boolean)
    const line = argv('create', 'my-extension', '--source', 'templates')

    expect(declared).toContain('--source')
    expect(telemetryCommandContext('create', line).source).toBe('templates')
  })
})
