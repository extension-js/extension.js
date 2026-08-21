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

// Signing is the difference between an extension Safari lists and one it
// refuses unless a human re-ticks Develop > Allow Unsigned Extensions on every
// launch. That toggle is not stored in preferences, which is why it resets and
// why it cannot be scripted, so the signed path is the only one a repeatable
// workflow can rely on.
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

// The enabling steps differ by signature, and pointing a signed user at the
// developer menu sends them to a toggle that is not why their extension is
// missing from the list.
describe('safari enabling hints follow the signature', () => {
  it('keeps the unsigned steps when no team signed the build', () => {
    expect(messages.safariNextSteps('My App')).toMatch(
      /Allow Unsigned Extensions/
    )
    expect(messages.safariOpenHint('/tmp/My App.app', 'My App')).toMatch(
      /Allow Unsigned Extensions/
    )
  })

  it('drops the developer menu once the build is signed', () => {
    const steps = messages.safariNextSteps('My App', true)
    expect(steps).not.toMatch(/Allow Unsigned Extensions/)
    expect(steps).toMatch(/Settings/)
    expect(steps).toMatch(/Extensions/)

    const hint = messages.safariOpenHint('/tmp/My App.app', 'My App', true)
    expect(hint).not.toMatch(/Allow Unsigned Extensions/)
    expect(hint).toMatch(/Settings/)
    // The launch line is the same either way: registration still needs it.
    expect(hint).toMatch(/My App\.app/)
  })
})
