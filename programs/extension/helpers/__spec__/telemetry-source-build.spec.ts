import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {isSourceCheckout, Telemetry} from '../telemetry'

const originalEnv = {...process.env}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value
  }
}

let home = ''

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-source-build-'))
  process.env.XDG_CONFIG_HOME = home
  process.env.XDG_CACHE_HOME = home
})

afterEach(restoreEnv)

function auditedProperties(): Record<string, unknown> {
  const auditFile = path.join(home, 'extensionjs', 'telemetry', 'events.jsonl')
  const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n')
  return JSON.parse(lines[lines.length - 1]).properties
}

describe('a run from a clone is not a run from an install', () => {
  it('calls every package-manager directory an install', () => {
    const installed = [
      '/home/dev/app/node_modules/extension/dist',
      '/home/dev/app/node_modules/.pnpm/extension@4.0.24/node_modules/extension/dist',
      'C:\\Users\\dev\\app\\node_modules\\extension\\dist',
      '/usr/local/lib/node_modules/extension/dist',
      '/home/dev/.npm/_npx/2f3a/node_modules/extension/dist',
      '/home/dev/app/.yarn/unplugged/extension-npm-4.0.24/dist',
      '/home/dev/.bun/install/cache/extension@4.0.24/dist'
    ]
    for (const dir of installed) {
      expect(isSourceCheckout(dir), dir).toBe(false)
    }
  })

  it('calls a checkout of this repository a source build', () => {
    const checkouts = [
      '/home/dev/extension.js/programs/extension/dist',
      '/Users/dev/local/extension-land/extension.js/programs/extension',
      'C:\\src\\extension.js\\programs\\extension\\dist'
    ]
    for (const dir of checkouts) {
      expect(isSourceCheckout(dir), dir).toBe(true)
    }
  })

  it('does not mistake a partial name for a marker segment', () => {
    expect(isSourceCheckout('/home/dev/my_node_modules_backup/extension')).toBe(
      true
    )
    expect(isSourceCheckout('/home/dev/node_modules_old/extension')).toBe(true)
    expect(isSourceCheckout('/home/dev/node_modules/extension')).toBe(false)
  })

  it('answers something rather than throwing on a missing path', () => {
    expect(isSourceCheckout('')).toBe(true)
    expect(isSourceCheckout(undefined as unknown as string)).toBe(true)
  })

  it('rides on every event as a boolean beside is_ci', () => {
    const telemetry = new Telemetry({app: 'extension', version: '4.0.24'})
    telemetry.track('command_executed', {
      command: 'create',
      success: true,
      version: '4.0.24'
    })
    const properties = auditedProperties()
    expect(typeof properties.is_source_build).toBe('boolean')
    expect(typeof properties.is_ci).toBe('boolean')
  })

  it('carries no path, no user and no new field beyond the boolean', () => {
    const telemetry = new Telemetry({app: 'extension', version: '4.0.24'})
    telemetry.track('command_executed', {
      command: 'create',
      success: true,
      version: '4.0.24'
    })
    const properties = auditedProperties()
    expect(Object.keys(properties).sort()).toEqual(
      [
        '$ip',
        'app',
        'arch',
        'command',
        'is_ci',
        'is_source_build',
        'node_major',
        'os',
        'success',
        'version'
      ].sort()
    )
    const serialised = JSON.stringify(properties)
    expect(serialised).not.toContain(os.homedir())
    expect(serialised).not.toContain(path.sep + 'node_modules')
  })
})

/* @invariant This is the defect the property was nearly inferred from. A
 * published canary is thirty-three characters and the old cap was thirty-two,
 * so the sha arrived one character short and matched nothing on npm. Every
 * unmatched canary string in the ninety-day window was exactly this.
 */
describe('a published version survives the emitter intact', () => {
  it('does not truncate the canary version npm actually published', () => {
    const published = '4.0.19-canary.1785200797.ce99a79e'
    expect(published).toHaveLength(33)
    const telemetry = new Telemetry({app: 'extension', version: published})
    telemetry.track('command_executed', {
      command: 'create',
      success: true,
      version: published
    })
    expect(auditedProperties().version).toBe(published)
  })

  it('still bounds a version that is not a version at all', () => {
    const telemetry = new Telemetry({app: 'extension', version: '4.0.24'})
    telemetry.track('command_executed', {
      command: 'create',
      success: true,
      version: 'x'.repeat(400)
    })
    expect(String(auditedProperties().version)).toHaveLength(64)
  })
})
