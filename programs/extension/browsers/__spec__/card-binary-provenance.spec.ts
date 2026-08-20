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

  it('marks a pinned binary', () => {
    const card = renderCard({
      binaryPath: '/opt/forks/thorium',
      binaryProvenance: 'pinned'
    })
    expect(card).toContain(
      'Browser        Chromium 139.0.7259.2 (pinned with --chromium-binary)'
    )
    expect(card).toContain('Binary         /opt/forks/thorium')
  })

  it('marks a system fallback binary', () => {
    const card = renderCard({
      binaryPath: '/Applications/Chromium.app/Contents/MacOS/Chromium',
      binaryProvenance: 'system'
    })
    expect(card).toContain(
      'Browser        Chromium 139.0.7259.2 (system, not the managed default)'
    )
    // No Binary row: the note above already says this is not the managed
    // default, and under MAX_CARD_ROWS that row would cost the Profile row.
    expect(card).not.toContain('Binary')
  })

  it('marks a cached snapshot binary', () => {
    const card = renderCard({
      binaryPath: '/Users/dev/.extension-js/binaries/chromium/snap/chromium',
      binaryProvenance: 'snapshot'
    })
    expect(card).toContain('(cached snapshot)')
    expect(card).not.toContain('Binary')
  })

  it('collapses the home dir in Profile and Binary card values only', () => {
    const home = os.homedir()
    const profile = path.join(home, '.extension-js', 'profiles', 'chrome')
    // Two cards, because MAX_CARD_ROWS means Binary and Profile never share
    // one: a non-managed launch spends the slot on the binary that actually
    // runs, a managed one has nothing to disambiguate and shows the profile.
    // The collapsing under test applies to both values either way.
    const pinnedCard = renderCard({
      binaryPath: path.join(home, 'bin', 'chromium'),
      binaryProvenance: 'pinned',
      profilePath: profile
    })
    expect(pinnedCard).toContain(
      `Binary         ~${path.sep}bin${path.sep}chromium`
    )
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

  it('renders one note per provenance and none for managed', () => {
    expect(binaryProvenanceNote('pinned')).toBe(
      '(pinned with --chromium-binary)'
    )
    expect(binaryProvenanceNote('system')).toBe(
      '(system, not the managed default)'
    )
    expect(binaryProvenanceNote('snapshot')).toBe('(cached snapshot)')
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
