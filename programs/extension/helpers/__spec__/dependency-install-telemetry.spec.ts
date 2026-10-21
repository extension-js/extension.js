import {afterEach, describe, expect, it} from 'vitest'
import {
  readDependencyInstall,
  recordDependencyInstall,
  resetDependencyInstall
} from '../dependency-install-outcome'
import {telemetryCommandContext} from '../telemetry-cli'

const createArgv = ['node', 'extension', 'create', 'my-extension']

afterEach(() => {
  resetDependencyInstall()
})

describe('dependency install outcome', () => {
  it('records nothing until create reports one', () => {
    expect(readDependencyInstall()).toBeNull()
    expect(telemetryCommandContext('create', createArgv)).not.toHaveProperty(
      'deps_install'
    )
  })

  it('reaches the create event as a fixed word and whole seconds', () => {
    recordDependencyInstall('installed', 30.6)
    const context = telemetryCommandContext('create', createArgv)

    expect(context.deps_install).toBe('installed')
    expect(context.deps_install_seconds).toBe(31)
  })

  it('reports a skipped install without a duration', () => {
    recordDependencyInstall('skipped')
    const context = telemetryCommandContext('create', createArgv)

    expect(context.deps_install).toBe('skipped')
    expect(context).not.toHaveProperty('deps_install_seconds')
  })

  it('stays off every command other than create', () => {
    recordDependencyInstall('failed', 12)

    expect(telemetryCommandContext('dev')).not.toHaveProperty('deps_install')
  })
})
