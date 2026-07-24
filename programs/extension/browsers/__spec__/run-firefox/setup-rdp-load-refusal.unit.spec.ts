import {beforeEach, describe, expect, it, vi} from 'vitest'

const ensureLoaded = vi.fn()
const getAddonInstallRefusalReason = vi.fn()

vi.mock('../../run-firefox/rdp/rdp-extension-controller', () => ({
  FirefoxRDPController: class {
    ensureLoaded = ensureLoaded
    getAddonInstallRefusalReason = getAddonInstallRefusalReason
  }
}))

const {setupRdpAfterLaunch} = await import(
  '../../run-firefox/firefox-launch/setup-rdp-after-launch'
)

const plugin = () => ({browser: 'firefox'}) as any
const compilation = {options: {output: {path: '/dist/firefox'}}} as any

describe('setupRdpAfterLaunch refusal reporting (§85)', () => {
  beforeEach(() => {
    ensureLoaded.mockReset()
    getAddonInstallRefusalReason.mockReset()
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

    await setupRdpAfterLaunch(plugin(), compilation, 9222).catch(() => {})

    expect(ensureLoaded).toHaveBeenCalledTimes(1)
  })

  // A transport failure may well be transient, so those still get the retries.
  it('keeps retrying a failure that is not a refusal', async () => {
    ensureLoaded.mockRejectedValue(new Error('socket closed'))
    getAddonInstallRefusalReason.mockReturnValue(null)

    await setupRdpAfterLaunch(plugin(), compilation, 9222).catch(() => {})

    expect(ensureLoaded.mock.calls.length).toBeGreaterThan(1)
  })

  // Without a reason the launcher must keep treating the failure as a launch
  // error, not stamp a refusal the browser never pronounced.
  it('leaves a transport failure unmarked', async () => {
    ensureLoaded.mockRejectedValue(new Error('socket closed'))
    getAddonInstallRefusalReason.mockReturnValue(null)

    const error = await setupRdpAfterLaunch(plugin(), compilation, 9222).catch(
      (e: unknown) => e
    )

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
