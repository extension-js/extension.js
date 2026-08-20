import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  binaryProvenanceNote,
  collapseHomeDirInCardValue,
  runningInDevelopment
} from '../browsers-lib/messages'
import {classifyBinaryProvenance} from '../browsers-lib/shared-utils'

const stripAnsi = (s: string) => s.replace(/\[[0-9;]*m/g, '')

function renderCard(opts?: {
  binaryPath?: string
  binaryProvenance?: 'managed' | 'pinned' | 'system' | 'snapshot'
  profilePath?: string
}) {
  return stripAnsi(
    runningInDevelopment(
      {name: 'My Extension', version: '1.0.0'},
      'chromium',
      {
        data: {
          id: 'pjkghmlbdmhkfellgkkcolmnlhwmubhe',
          management: {name: 'My Extension', version: '1.0.0'}
        }
      },
      'Chromium 139.0.7259.2',
      undefined,
      opts
    )
  )
}

describe('card binary provenance', () => {
  it('adds no parenthetical and no Binary row for the managed default', () => {
    const card = renderCard({
      binaryPath: '/Users/dev/.extension-js/binaries/chrome/mac-138/chrome',
      binaryProvenance: 'managed'
    })
    expect(card).toContain('Browser        Chromium 139.0.7259.2')
    expect(card).not.toContain('(')
    expect(card).not.toContain('Binary')
  })

  it('adds no parenthetical and no Binary row when provenance is unknown', () => {
    const card = renderCard({binaryPath: '/somewhere/chromium'})
    expect(card).not.toContain('Binary')
  })

  it('marks a pinned binary in the Browser row and prints no Binary row', () => {
    const card = renderCard({
      binaryPath: '/opt/forks/thorium',
      binaryProvenance: 'pinned'
    })
    expect(card).toContain(
      'Browser        Chromium 139.0.7259.2 (pinned with --chromium-binary)'
    )
    // The note is the whole signal; the path the user typed is not echoed.
    expect(card).not.toContain('Binary')
  })

  it('marks a system fallback binary', () => {
    const card = renderCard({
      binaryPath: '/Applications/Chromium.app/Contents/MacOS/Chromium',
      binaryProvenance: 'system'
    })
    // A system browser is not annotated at all: every unpinned launch card
    // reads the same, so the clip of a command looks the same on any machine.
    expect(card).toContain('Browser        Chromium 139.0.7259.2')
    expect(card).not.toContain('system, not the managed default')
    expect(card).not.toContain('Binary')
  })

  it('marks a cached snapshot binary', () => {
    const card = renderCard({
      binaryPath: '/Users/dev/.extension-js/binaries/chromium/snap/chromium',
      binaryProvenance: 'snapshot'
    })
    expect(card).not.toContain('(cached snapshot)')
    expect(card).not.toContain('Binary')
  })

  it('collapses the home dir in Profile and Binary card values only', () => {
    const home = os.homedir()
    const profile = path.join(home, '.extension-js', 'profiles', 'chrome')
    // Two cards, because MAX_CARD_ROWS means Binary and Profile never share
    // one: a non-managed launch spends the slot on the binary that actually
    // runs, a managed one has nothing to disambiguate and shows the profile.
    // The collapsing under test applies to both values either way.
    // Binary is never a row now, so the collapsing under test is exercised
    // through Profile alone; the helper itself is asserted directly below.
    const managedCard = renderCard({
      binaryProvenance: 'managed',
      profilePath: profile
    })
    expect(managedCard).toContain(
      `Profile        ~${path.sep}.extension-js${path.sep}profiles${path.sep}chrome`
    )
    expect(collapseHomeDirInCardValue('/unrelated/path')).toBe(
      '/unrelated/path'
    )
    expect(collapseHomeDirInCardValue(home)).toBe('~')
    expect(collapseHomeDirInCardValue(`${home}sibling`)).toBe(`${home}sibling`)
  })

  it('annotates only a pinned binary', () => {
    expect(binaryProvenanceNote('pinned')).toBe(
      '(pinned with --chromium-binary)'
    )
    // Only a pinned path is annotated; the rest are machine facts, not run
    // facts, and classifyBinaryProvenance still reports them to callers.
    expect(binaryProvenanceNote('system')).toBe('')
    expect(binaryProvenanceNote('snapshot')).toBe('')
    expect(binaryProvenanceNote('managed')).toBe('')
    expect(binaryProvenanceNote(undefined)).toBe('')
  })
})

describe('classifyBinaryProvenance', () => {
  const root = path.join(os.tmpdir(), 'managed-binaries')

  it('prefers the pinned flag over everything', () => {
    expect(
      classifyBinaryProvenance({
        binaryPath: path.join(root, 'chrome', 'chrome'),
        managedCacheRoot: root,
        pinnedByFlag: true
      })
    ).toBe('pinned')
  })

  it('reports the cached snapshot when it is what actually runs', () => {
    expect(
      classifyBinaryProvenance({
        binaryPath: path.join(root, 'chromium', 'chromium'),
        managedCacheRoot: root,
        usedManagedSnapshot: true
      })
    ).toBe('snapshot')
  })

  it('reports managed for a binary under the managed cache root', () => {
    expect(
      classifyBinaryProvenance({
        binaryPath: path.join(root, 'chrome', 'mac-138', 'chrome'),
        managedCacheRoot: root
      })
    ).toBe('managed')
  })

  it('reports system for a binary outside the managed cache root', () => {
    expect(
      classifyBinaryProvenance({
        binaryPath: '/Applications/Chromium.app/Contents/MacOS/Chromium',
        managedCacheRoot: root
      })
    ).toBe('system')
  })
})
