import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {FirefoxLaunchPlugin} from '../../run-firefox/firefox-launch'

const REASON =
  'Could not install add-on: Error: Extension is invalid Reading manifest: Error processing browser_specific_settings.gecko.id'

// The launch itself is stubbed: what is under test is what a run does once
// Firefox has answered that it refuses the add-on.
function launcherThatMeetsARefusal(
  mode: 'production' | 'development',
  outPath = '/proj/dist/firefox'
) {
  const host: Record<string, unknown> = {
    browser: 'firefox',
    extension: [outPath]
  }
  const launcher = new FirefoxLaunchPlugin(
    host as never,
    {setController: vi.fn(), getController: vi.fn()} as never
  )
  const inner = launcher as unknown as {
    launch: () => Promise<void>
    cleanupInstance: () => Promise<void>
    reportReady: () => void
    extensionOutputPath?: string
  }
  const cleanup = vi.spyOn(inner, 'cleanupInstance').mockResolvedValue()

  vi.spyOn(inner, 'reportReady').mockImplementation(() => {})
  vi.spyOn(inner, 'launch').mockImplementation(async () => {
    inner.extensionOutputPath = outPath
    host.extensionLoadRefused = REASON
  })

  return {
    cleanup,
    run: () =>
      launcher.runOnce({options: {mode}} as never, {mode} as never).then(
        () => null,
        (error: unknown) => error as Error & {code?: string}
      )
  }
}

describe('a run-only Firefox launch the browser refuses', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ends the run with the code and the frame Chromium ends on', async () => {
    const {run, cleanup} = launcherThatMeetsARefusal('production')
    const error = await run()

    expect(error?.code).toBe('E_EXTENSION_LOAD_REFUSED')
    expect(error?.message).toContain('Firefox refuses to load this extension')
    expect(error?.message).toContain('/proj/dist/firefox')
    expect(error?.message).toContain(REASON)
    expect(error?.message).toContain(
      'Fix what the browser names, then run the command again.'
    )

    // The browser this run started holds nothing, so it goes with the run.
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  // Firefox answers a version above 3 with an internal TypeError, so the
  // frame adds the cause the manifest shows and keeps the browser's words.
  it('names the cause the manifest shows beside the reason', async () => {
    const outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-cause-'))

    try {
      fs.writeFileSync(
        path.join(outPath, 'manifest.json'),
        JSON.stringify({manifest_version: 4, name: 'x', version: '1'})
      )

      const error = await launcherThatMeetsARefusal('production', outPath).run()

      expect(error?.message).toContain(`REASON ${REASON}`)
      expect(error?.message).toContain(
        'CAUSE Firefox does not load a manifest_version above 3.'
      )
    } finally {
      fs.rmSync(outPath, {recursive: true, force: true})
    }
  })

  it('keeps a dev session up, since a save can be loaded again', async () => {
    const {run, cleanup} = launcherThatMeetsARefusal('development')

    expect(await run()).toBeNull()
    expect(cleanup).not.toHaveBeenCalled()
  })
})
