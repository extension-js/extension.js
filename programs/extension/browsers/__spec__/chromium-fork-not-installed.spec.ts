import {describe, expect, it, vi} from 'vitest'
import * as messages from '../browsers-lib/messages'
import {chromiumForkInstallGuidance} from '../run-chromium/chromium-launch/fork-install-guidance'

vi.mock('vivaldi-location2', () => ({
  default: () => null,
  getInstallGuidance: () =>
    [
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
      expect(chromiumForkInstallGuidance(fork)).not.toBeNull()
    }

    for (const managed of ['chrome', 'chromium', 'edge', 'firefox', 'zen']) {
      expect(chromiumForkInstallGuidance(managed)).toBeNull()
    }
  })
})
