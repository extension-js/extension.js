import {beforeEach, describe, expect, it, vi} from 'vitest'

const ensureLoaded = vi.fn()
const getAddonInstallRefusalReason = vi.fn()
const disconnect = vi.fn()

vi.mock('../../run-firefox/rdp/rdp-extension-controller', () => ({
  FirefoxRDPController: class {
    ensureLoaded = ensureLoaded
    getAddonInstallRefusalReason = getAddonInstallRefusalReason
    disconnect = disconnect
  }
}))

const {setupRdpAfterLaunch} = await import(
  '../../run-firefox/firefox-launch/setup-rdp-after-launch'
)

type Runtime = Parameters<typeof setupRdpAfterLaunch>[0]
type Compilation = Parameters<typeof setupRdpAfterLaunch>[1]

const plugin = () => ({browser: 'firefox'}) as Runtime
const compilation: Compilation = {options: {output: {path: '/dist/firefox'}}}

describe('setupRdpAfterLaunch refusal reporting', () => {
  beforeEach(() => {
    ensureLoaded.mockReset()
    getAddonInstallRefusalReason.mockReset()
    disconnect.mockReset()
  })

  it('closes the connection of a controller it gives up on', async () => {
    ensureLoaded.mockRejectedValue(new Error('install failed'))
    getAddonInstallRefusalReason.mockReturnValue('Extension is invalid')

    await expect(
      setupRdpAfterLaunch(plugin(), compilation, 9222)
    ).rejects.toThrow('install failed')

    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps the connection of a controller it publishes', async () => {
    ensureLoaded.mockResolvedValue(undefined)

    await setupRdpAfterLaunch(plugin(), compilation, 9222)

    expect(disconnect).not.toHaveBeenCalled()
  })

  // The controller is created inside this function, so a throwing install
  // would otherwise carry Gecko's reason out of reach of the launcher.
  it("attaches Gecko's reason to the error it throws", async () => {
    ensureLoaded.mockRejectedValue(new Error('install failed'))
    getAddonInstallRefusalReason.mockReturnValue(
      'Error: Extension is invalid / Reading manifest: …gecko.id'
    )

    const error = await setupRdpAfterLaunch(plugin(), compilation, 9222).catch(
      (e: unknown) => e
    )

    expect(
      (error as {extensionLoadRefusedReason?: string})
        .extensionLoadRefusedReason
    ).toBe('Error: Extension is invalid / Reading manifest: …gecko.id')
  })

  // The browser already judged these bytes, so re-asking cannot change the
  // answer: it only delays the report and repeats the reason.
  it('stops retrying as soon as the failure is a refusal', async () => {
    ensureLoaded.mockRejectedValue(new Error('install failed'))
    getAddonInstallRefusalReason.mockReturnValue('Extension is invalid')

    await expect(
      setupRdpAfterLaunch(plugin(), compilation, 9222)
    ).rejects.toThrow('install failed')

    expect(ensureLoaded).toHaveBeenCalledTimes(1)
  })

  // A transport failure may well be transient, so those still get the retries.
  it('keeps retrying a failure that is not a refusal', async () => {
    ensureLoaded.mockRejectedValue(new Error('socket closed'))
    getAddonInstallRefusalReason.mockReturnValue(null)

    await expect(
      setupRdpAfterLaunch(plugin(), compilation, 9222, 1)
    ).rejects.toThrow('socket closed')

    expect(ensureLoaded).toHaveBeenCalledTimes(5)
  })

  // No attempt follows the fifth failure, so its error surfaces at once.
  it('doubles a 150 ms pause after each failure when the caller names none', async () => {
    vi.useFakeTimers()

    try {
      ensureLoaded.mockRejectedValue(new Error('socket closed'))
      getAddonInstallRefusalReason.mockReturnValue(null)

      let outcome: unknown
      void setupRdpAfterLaunch(plugin(), compilation, 9222).catch(
        (error: unknown) => {
          outcome = error
        }
      )

      await vi.advanceTimersByTimeAsync(0)
      expect(ensureLoaded).toHaveBeenCalledTimes(1)

      for (const [index, pause] of [150, 300, 600, 1200].entries()) {
        await vi.advanceTimersByTimeAsync(pause - 1)
        expect(ensureLoaded).toHaveBeenCalledTimes(index + 1)

        await vi.advanceTimersByTimeAsync(1)
        expect(ensureLoaded).toHaveBeenCalledTimes(index + 2)
      }

      await vi.advanceTimersByTimeAsync(0)
      expect((outcome as Error).message).toBe('socket closed')
      expect(ensureLoaded).toHaveBeenCalledTimes(5)
    } finally {
      vi.useRealTimers()
    }
  })

  // Without a reason the launcher must keep treating the failure as a launch
  // error, not stamp a refusal the browser never pronounced.
  it('leaves a transport failure unmarked', async () => {
    ensureLoaded.mockRejectedValue(new Error('socket closed'))
    getAddonInstallRefusalReason.mockReturnValue(null)

    const error = await setupRdpAfterLaunch(
      plugin(),
      compilation,
      9222,
      1
    ).catch((e: unknown) => e)

    expect(
      (error as {extensionLoadRefusedReason?: string})
        .extensionLoadRefusedReason
    ).toBeUndefined()

    expect((error as Error).message).toBe('socket closed')
  })

  it('publishes the controller when the install succeeds', async () => {
    ensureLoaded.mockResolvedValue(undefined)
    const host = plugin()

    const controller = await setupRdpAfterLaunch(host, compilation, 9222)

    expect(controller).toBeDefined()
    expect(host.rdpController).toBe(controller)
  })
})
