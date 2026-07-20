import {beforeEach, describe, expect, it} from 'vitest'
import {
  getInstancePorts,
  getLastCDPPort,
  getLastRDPPort,
  setInstancePorts
} from '../browsers-lib/instance-registry'
import {ready} from '../browsers-lib/ready-message'

const stripAnsi = (s: string) => s.replace(/\[[0-9;]*m/g, '')

describe('ready() banner message', () => {
  it('labels Chromium-family browsers an "Extension"', () => {
    const msg = stripAnsi(ready('development', 'chrome'))
    expect(msg).toContain('Chrome Extension')
    expect(msg).toContain('ready for development')
  })

  it('labels Firefox-family browsers an "Add-on" and normalizes the name', () => {
    for (const browser of ['firefox', 'gecko-based', 'firefox-based']) {
      const msg = stripAnsi(ready('production', browser))
      expect(msg).toContain('Firefox Add-on')
      expect(msg).toContain('ready for production')
    }
  })

  it('treats edge as an Add-on output while keeping its own capitalized name', () => {
    const msg = stripAnsi(ready('development', 'edge'))
    expect(msg).toContain('Add-on')
    expect(msg).toContain('Edge')
  })

  it('does not throw and capitalizes for an unknown browser', () => {
    const msg = stripAnsi(ready('development', 'brave'))
    expect(msg).toContain('Brave Extension')
  })

  it('tolerates an empty browser string', () => {
    expect(() => ready('development', '')).not.toThrow()
  })
})

describe('instance port registry', () => {
  beforeEach(() => {
    setInstancePorts('reset-a', {cdpPort: 1, rdpPort: 2})
  })

  it('returns undefined for an unknown or missing instance id', () => {
    expect(getInstancePorts('never-set')).toBeUndefined()
    expect(getInstancePorts(undefined)).toBeUndefined()
  })

  it('stores and retrieves ports per instance id', () => {
    setInstancePorts('inst-1', {cdpPort: 9222})
    expect(getInstancePorts('inst-1')).toEqual({cdpPort: 9222})
  })

  it('merges partial updates rather than replacing the record', () => {
    setInstancePorts('inst-2', {cdpPort: 9333})
    setInstancePorts('inst-2', {rdpPort: 6000})
    expect(getInstancePorts('inst-2')).toEqual({cdpPort: 9333, rdpPort: 6000})
  })

  it('tracks the last-seen CDP and RDP ports globally', () => {
    setInstancePorts('inst-3', {cdpPort: 9444})
    setInstancePorts(undefined, {rdpPort: 6111})
    expect(getLastCDPPort()).toBe(9444)
    expect(getLastRDPPort()).toBe(6111)
  })

  it('does not throw when given no instance id but valid ports', () => {
    expect(() => setInstancePorts(undefined, {cdpPort: 9555})).not.toThrow()
    expect(getLastCDPPort()).toBe(9555)
  })
})
