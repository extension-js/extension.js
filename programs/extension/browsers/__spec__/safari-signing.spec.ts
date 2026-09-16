import {describe, expect, it} from 'vitest'
import * as messages from '../browsers-lib/messages'
import {composeXcodebuildArgs} from '../run-safari/safari-launch/safari-config'
import type {SafariBuildConfig} from '../run-safari/safari-types'

const base: SafariBuildConfig = {
  extensionDir: '/tmp/proj/dist/safari',
  projectLocation: '/tmp/proj/dist/safari-xcode',
  appName: 'my-ext',
  bundleIdentifier: 'dev.extensionjs.my-ext',
  bundleIdDerived: true,
  macOsOnly: true,
  language: 'swift',
  open: true
}

// Measured with the toggle off: an ad-hoc signed app stays listed in Safari
// Settings while a folder-loaded extension disappears. So a signature decides
// the identity a build carries, not whether Safari will load it locally.
describe('safari xcodebuild signing', () => {
  it('signs ad-hoc when no team is given, so a local build still works', () => {
    const args = composeXcodebuildArgs(base)
    expect(args).toContain('CODE_SIGN_IDENTITY=-')
    expect(args).toContain('CODE_SIGNING_REQUIRED=NO')
    expect(args.some((a) => a.startsWith('DEVELOPMENT_TEAM='))).toBe(false)
    expect(args).not.toContain('-allowProvisioningUpdates')
  })

  it('signs for real when a team is given, and drops the ad-hoc identity', () => {
    const args = composeXcodebuildArgs({...base, developmentTeam: 'JU3XAJJQ2G'})
    expect(args).toContain('DEVELOPMENT_TEAM=JU3XAJJQ2G')
    expect(args).toContain('CODE_SIGN_STYLE=Automatic')
    // Without this xcodebuild refuses to mint a profile outside Xcode.
    expect(args).toContain('-allowProvisioningUpdates')
    // Leaving these in would defeat the signature we just asked for.
    expect(args).not.toContain('CODE_SIGN_IDENTITY=-')
    expect(args).not.toContain('CODE_SIGNING_REQUIRED=NO')
  })

  it('ignores a blank team rather than emitting an empty setting', () => {
    for (const team of ['', '   ']) {
      const args = composeXcodebuildArgs({...base, developmentTeam: team})
      expect(args).toContain('CODE_SIGN_IDENTITY=-')
      expect(args.some((a) => a.startsWith('DEVELOPMENT_TEAM='))).toBe(false)
    }
  })

  it('keeps the project, scheme and derived data path in both modes', () => {
    for (const cfg of [base, {...base, developmentTeam: 'JU3XAJJQ2G'}]) {
      const args = composeXcodebuildArgs(cfg)
      expect(args).toContain('-project')
      expect(args).toContain('-scheme')
      expect(args).toContain('-derivedDataPath')
      expect(args[args.length - 1]).toBe('build')
    }
  })
})

// No message may send anyone to the developer menu. An ad-hoc app does not need
// it, and the one path that does, folder loading, is not something the CLI ships.
describe('safari enabling hints never prescribe the developer menu', () => {
  it('keeps the developer menu out of both signatures', () => {
    for (const steps of [
      messages.safariNextSteps('My App'),
      messages.safariNextSteps('My App', true)
    ]) {
      expect(steps).not.toMatch(/Allow Unsigned Extensions/)
      expect(steps).not.toMatch(/Develop/)
      expect(steps).toMatch(/Settings/)
      expect(steps).toMatch(/Extensions/)
    }
  })

  it('enables the same way whatever signed the build', () => {
    const hint = messages.safariOpenHint('/tmp/My App.app', 'My App')
    expect(hint).not.toMatch(/Allow Unsigned Extensions/)
    expect(hint).toMatch(/Settings/)
    // The launch line is still needed: registration happens on first open.
    expect(hint).toMatch(/My App\.app/)
  })

  it('names what a team id buys without claiming it changes loading', () => {
    expect(messages.safariNextSteps('My App', true)).toMatch(/distribution/)
    expect(messages.safariNextSteps('My App')).toMatch(/stays enabled/)
  })
})
