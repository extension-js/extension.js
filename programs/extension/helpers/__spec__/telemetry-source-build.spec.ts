import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {isSourceCheckout, type TelemetryDeps} from '../telemetry'
import {readRows, useTelemetrySandbox} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

function auditedProperties(
  version: string,
  deps: Partial<TelemetryDeps> = {},
  env: Record<string, string> = {}
): Record<string, unknown> {
  const box = sandbox({env, deps})

  box.telemetry({version}).track('command_executed', {
    command: 'create',
    success: true,
    version
  })

  return readRows(path.join(box.configDir, 'events.jsonl')).at(-1)
    ?.properties as Record<string, unknown>
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

  it.each([
    ['/home/dev/app/node_modules/extension/dist', false],
    ['/home/dev/extension.js/programs/extension/dist', true]
  ])('rides on every event: %s is_source_build=%s', (sourceDir, expected) => {
    expect(auditedProperties('4.0.24', {sourceDir}).is_source_build).toBe(
      expected
    )
  })

  it.each([
    [{CI: '1'}, true],
    [{}, false]
  ])('marks is_ci from the CI detector: %j gives %s', (env, expected) => {
    expect(auditedProperties('4.0.24', {}, env).is_ci).toBe(expected)
  })

  it('carries no path, no user and no field beyond the audited list', () => {
    const box = sandbox({deps: {platform: 'win32'}})
    box.telemetry({version: '4.0.24'}).track('command_executed', {
      command: 'create',
      success: true,
      version: '4.0.24'
    })

    const properties = readRows(path.join(box.configDir, 'events.jsonl'))[0]
      .properties

    expect(properties).toEqual({
      $geoip_disable: true,
      $ip: null,
      app: 'extension',
      arch: process.arch,
      command: 'create',
      is_ci: false,
      is_source_build: isSourceCheckout(__dirname),
      node_major: Number(process.versions.node.split('.')[0]),
      os: 'win32',
      package_manager: 'unknown',
      success: true,
      version: '4.0.24'
    })

    expect(JSON.stringify(properties)).not.toContain(box.root)
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
    expect(auditedProperties(published).version).toBe(published)
  })

  it('still bounds a version that is not a version at all', () => {
    expect(String(auditedProperties('x'.repeat(400)).version)).toBe(
      'x'.repeat(64)
    )
  })
})
