import {describe, expect, it} from 'vitest'
import {
  mergeReloadInstructions,
  type ReloadInstruction,
  reloadSurvivingPackage
} from '../index'

// The package restarts the extension by itself, so the only reload still worth
// sending is the one a restart cannot deliver.
describe('reloadSurvivingPackage', () => {
  const CONTENT_ENTRY = 'content_scripts/content-0'

  it('drops a full reload, which would restart what just started', () => {
    expect(
      reloadSurvivingPackage({
        type: 'full',
        changedAssets: ['src/manifest.json'],
        label: 'extension (src/manifest.json)'
      })
    ).toBeUndefined()
  })

  it('drops a background-only service-worker reload', () => {
    expect(
      reloadSurvivingPackage({
        type: 'service-worker',
        changedAssets: ['src/background.js'],
        label: 'service_worker (src/background.js)'
      })
    ).toBeUndefined()
  })

  it('keeps a content-scripts reload untouched', () => {
    const instruction = {
      type: 'content-scripts' as const,
      changedContentScriptEntries: [CONTENT_ENTRY],
      changedAssets: ['src/content/scripts.js'],
      label: 'content_script (src/content/scripts.js)'
    }
    expect(reloadSurvivingPackage(instruction)).toEqual(instruction)
  })

  it('downgrades a shared background + content edit to its content half', () => {
    expect(
      reloadSurvivingPackage({
        type: 'service-worker',
        changedContentScriptEntries: [CONTENT_ENTRY],
        changedAssets: ['src/shared.ts'],
        label: 'service_worker + content_script (src/shared.ts)'
      })
    ).toEqual({
      type: 'content-scripts',
      changedContentScriptEntries: [CONTENT_ENTRY],
      changedAssets: ['src/shared.ts'],
      label: 'content_script (src/shared.ts)'
    })
  })

  it('keeps a notify-only page instruction, which restarts nothing', () => {
    const instruction = {
      type: 'page' as const,
      changedAssets: ['src/popup/index.js'],
      label: 'popup page (src/popup/index.js)'
    }
    expect(reloadSurvivingPackage(instruction)).toEqual(instruction)
  })

  it('is a no-op for no instruction', () => {
    expect(reloadSurvivingPackage(undefined)).toBeUndefined()
  })
})

// One package answers a whole burst of saves, so the reloads the burst asked
// for travel as one instruction.
describe('mergeReloadInstructions', () => {
  const content = (
    entry: string,
    source: string,
    more: Partial<ReloadInstruction> = {}
  ): ReloadInstruction => ({
    type: 'content-scripts',
    changedContentScriptEntries: [entry],
    changedAssets: [source],
    label: `content_script (${source})`,
    ...more
  })
  const page = (
    source: string,
    more: Partial<ReloadInstruction> = {}
  ): ReloadInstruction => ({
    type: 'page',
    changedAssets: [source],
    label: `page (${source})`,
    ...more
  })

  it('answers the one side that holds an instruction', () => {
    const only = page('src/popup/index.js')

    expect(mergeReloadInstructions(undefined, only)).toBe(only)
    expect(mergeReloadInstructions(only, undefined)).toBe(only)
    expect(mergeReloadInstructions(undefined, undefined)).toBeUndefined()
  })

  it('unions the content entries of two content edits, sorted, under the newest label', () => {
    expect(
      mergeReloadInstructions(
        content('content_scripts/content-1', 'src/b.ts'),
        content('content_scripts/content-0', 'src/a.ts')
      )
    ).toEqual({
      type: 'content-scripts',
      changedContentScriptEntries: [
        'content_scripts/content-0',
        'content_scripts/content-1'
      ],
      changedAssets: ['src/a.ts'],
      label: 'content_script (src/a.ts)'
    })
  })

  it('keeps one copy of an entry both edits touched', () => {
    expect(
      mergeReloadInstructions(
        content('content_scripts/content-0', 'src/a.ts'),
        content('content_scripts/content-0', 'src/b.ts')
      )?.changedContentScriptEntries
    ).toEqual(['content_scripts/content-0'])
  })

  it('keeps the content edit when a page edit lands after it', () => {
    expect(
      mergeReloadInstructions(
        content('content_scripts/content-0', 'src/a.ts'),
        page('src/popup/index.js')
      )
    ).toEqual(content('content_scripts/content-0', 'src/a.ts'))
  })

  it('answers the newest of two edits that name no content entry', () => {
    const newest = page('src/options/index.js')

    expect(mergeReloadInstructions(page('src/popup/index.js'), newest)).toBe(
      newest
    )
  })

  // The worker replays an injected file by name, so a file an earlier save
  // of the burst rebuilt still has to be named.
  it('unions the injected script files, with and without content entries', () => {
    expect(
      mergeReloadInstructions(
        page('src/scripts/b.ts', {changedScriptFiles: ['scripts/b.js']}),
        page('src/scripts/a.ts', {changedScriptFiles: ['scripts/a.js']})
      )
    ).toEqual(
      page('src/scripts/a.ts', {
        changedScriptFiles: ['scripts/a.js', 'scripts/b.js']
      })
    )

    expect(
      mergeReloadInstructions(
        page('src/scripts/b.ts', {changedScriptFiles: ['scripts/b.js']}),
        content('content_scripts/content-0', 'src/a.ts')
      )
    ).toEqual(
      content('content_scripts/content-0', 'src/a.ts', {
        changedScriptFiles: ['scripts/b.js']
      })
    )
  })
})
