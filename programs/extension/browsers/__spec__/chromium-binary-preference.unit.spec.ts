import {describe, it, expect} from 'vitest'
import {chooseChromiumBinaryPreferringStable} from '../browsers-lib/shared-utils'

const SNAPSHOT =
  '/Users/dev/Library/Caches/extension.js/browsers/chromium/chromium/mac_arm-1659983/chrome-mac/Chromium.app/Contents/MacOS/Chromium'
const SYSTEM = '/Applications/Chromium.app/Contents/MacOS/Chromium'
const CACHE_ROOT = '/Users/dev/Library/Caches/extension.js/browsers'

describe('chooseChromiumBinaryPreferringStable', () => {
  it('prefers an installed system browser over the managed snapshot by default', () => {
    const choice = chooseChromiumBinaryPreferringStable({
      managedSnapshotBinary: SNAPSHOT,
      systemBinary: SYSTEM,
      managedCacheRoot: CACHE_ROOT
    })
    expect(choice.binary).toBe(SYSTEM)
    expect(choice.swappedToSystem).toBe(true)
    expect(choice.usedManagedSnapshot).toBe(false)
  })

  it('keeps the managed snapshot when EXTENSION_PREFER_CHROMIUM_SNAPSHOT opts in', () => {
    const choice = chooseChromiumBinaryPreferringStable({
      managedSnapshotBinary: SNAPSHOT,
      systemBinary: SYSTEM,
      managedCacheRoot: CACHE_ROOT,
      preferManagedSnapshot: true
    })
    expect(choice.binary).toBe(SNAPSHOT)
    expect(choice.usedManagedSnapshot).toBe(true)
    expect(choice.swappedToSystem).toBe(false)
  })

  it('falls back to the managed snapshot when no system browser exists', () => {
    const choice = chooseChromiumBinaryPreferringStable({
      managedSnapshotBinary: SNAPSHOT,
      systemBinary: null,
      managedCacheRoot: CACHE_ROOT
    })
    expect(choice.binary).toBe(SNAPSHOT)
    expect(choice.usedManagedSnapshot).toBe(true)
    expect(choice.swappedToSystem).toBe(false)
  })

  it('does not treat a puppeteer-cache path as a stable system browser', () => {
    const choice = chooseChromiumBinaryPreferringStable({
      managedSnapshotBinary: SNAPSHOT,
      systemBinary:
        '/Users/dev/Library/Caches/puppeteer/chromium/mac_arm-1659983/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      managedCacheRoot: CACHE_ROOT
    })
    expect(choice.binary).toBe(SNAPSHOT)
    expect(choice.usedManagedSnapshot).toBe(true)
    expect(choice.swappedToSystem).toBe(false)
  })

  it('does not treat a binary under the managed cache root as a system browser', () => {
    const choice = chooseChromiumBinaryPreferringStable({
      managedSnapshotBinary: SNAPSHOT,
      systemBinary: `${CACHE_ROOT}/chromium/other/mac_arm-1/Chromium.app/Contents/MacOS/Chromium`,
      managedCacheRoot: CACHE_ROOT
    })
    expect(choice.binary).toBe(SNAPSHOT)
    expect(choice.usedManagedSnapshot).toBe(true)
    expect(choice.swappedToSystem).toBe(false)
  })

  it('is a no-op when there is no managed snapshot', () => {
    const choice = chooseChromiumBinaryPreferringStable({
      managedSnapshotBinary: null,
      systemBinary: SYSTEM,
      managedCacheRoot: CACHE_ROOT
    })
    expect(choice.binary).toBeNull()
    expect(choice.usedManagedSnapshot).toBe(false)
    expect(choice.swappedToSystem).toBe(false)
  })
})
