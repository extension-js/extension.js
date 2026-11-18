import {describe, expect, it, vi} from 'vitest'
import * as messages from '../../browsers-lib/messages'
import {chromiumForkInstallGuidance} from '../../run-chromium/chromium-launch/fork-install-guidance'

const vivaldiLocator = vi.hoisted(() => ({throws: false}))

vi.mock('vivaldi-location2', () => ({
  default: () => null,
  getInstallGuidance: () => {
    if (vivaldiLocator.throws) throw new Error('the locator broke')

    return [
      "We couldn't find a Vivaldi browser on this machine.",
      '',
      'To install one:',
      '',
      '1) Install Vivaldi from the official site',
      '',
      'Re-run your command afterward and it will be detected automatically.',
      '',
      'Alternatively, set VIVALDI_BINARY=/path/to/vivaldi and re-run.'
    ].join('\n')
  }
}))

function stripAnsi(text: string) {
  return text.replace(/\[[0-9;]*m/g, '')
}

describe('a system-located chromium fork that is not installed', () => {
  it('names the fork and its own install steps, not a placeholder binary', () => {
    const guidance = chromiumForkInstallGuidance('vivaldi')
    expect(guidance).not.toBeNull()

    const printed = stripAnsi(
      messages.chromiumForkNotInstalled('vivaldi', guidance as string)
    )
    expect(printed).toContain("Vivaldi isn't installed")
    expect(printed).toContain('Install Vivaldi from the official site')
    expect(printed).toContain('VIVALDI_BINARY')
    expect(printed).toContain('--chromium-binary')
    expect(printed).toContain('vivaldi')
    expect(printed).not.toContain('BROWSER')
    expect(printed).not.toContain("We couldn't find")
    expect(printed).not.toContain('Re-run your command')
    expect(printed).not.toContain('chrome|edge|firefox')
  })

  it('answers only for the forks the launcher locates on the system', () => {
    for (const fork of ['brave', 'opera', 'vivaldi', 'yandex']) {
      expect(chromiumForkInstallGuidance(fork), fork).toMatch(/install/i)
    }

    for (const managed of ['chrome', 'chromium', 'edge', 'firefox', 'zen']) {
      expect(chromiumForkInstallGuidance(managed)).toBeNull()
    }
  })

  it('prints an install step of its own when the locator throws', () => {
    vivaldiLocator.throws = true

    try {
      const guidance = chromiumForkInstallGuidance('vivaldi')

      // The launcher asks only whether this is null, so it prints the block.
      expect(guidance).toBe('')
      const lines = stripAnsi(
        messages.chromiumForkNotInstalled('vivaldi', guidance ?? '')
      ).split('\n')

      expect(lines[0].endsWith(" Vivaldi isn't installed.")).toBe(true)
      expect(lines.slice(1)).toEqual([
        'Install Vivaldi, then run the command again.',
        'Or point at a binary with --chromium-binary <path>, or choose another browser with --browser <chrome|chromium|edge|brave|opera|vivaldi|yandex>.'
      ])
    } finally {
      vivaldiLocator.throws = false
    }
  })
})
