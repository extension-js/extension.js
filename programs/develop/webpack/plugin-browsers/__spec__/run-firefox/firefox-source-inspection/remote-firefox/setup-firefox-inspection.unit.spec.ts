import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock(
  '../../../../../run-firefox/firefox-source-inspection/remote-firefox/messaging-client',
  () => {
    class MessagingClientMock {
      async connect(_port: number) {}
      async evaluate(_actor: string, _expr: string) {
        return 'http://example/'
      }
      async navigateViaScript(_actor: string, _url: string) {}
      async getTargets() {
        return [{actor: 'tab', consoleActor: 'console'}]
      }
      async getTargetFromDescriptor(_actor: string) {
        return {consoleActor: 'console'}
      }
      async waitForPageReady(_actor: string, _url: string, _timeout: number) {}
      async getPageHTML(_descriptor: string, _consoleActor: string) {
        return '<html>ok</html>'
      }
    }
    return {MessagingClient: MessagingClientMock}
  }
)

vi.mock(
  '../../../../../run-firefox/firefox-source-inspection/remote-firefox/setup-firefox-inspection-actors',
  () => ({
    selectActors: vi.fn(async () => ({
      tabActor: 'tab',
      consoleActor: 'console'
    }))
  })
)

vi.mock(
  '../../../../../run-firefox/firefox-source-inspection/remote-firefox/setup-firefox-inspection-navigation',
  () => ({
    ensureNavigatedAndLoaded: vi.fn(async () => undefined)
  })
)

vi.mock('../../../../../run-firefox/browsers-lib/shared-utils', () => ({
  deriveDebugPortWithInstance: vi.fn(
    (_port: number, _instance?: string) => 6000
  )
}))

import {SetupFirefoxInspectionStep} from '../../../../../run-firefox/firefox-source-inspection'

describe('SetupFirefoxInspectionStep (unit)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes and sets up actors and prints HTML without errors', async () => {
    const step = new SetupFirefoxInspectionStep({
      browser: 'firefox',
      port: 6000,
      source: 'http://example/'
    }) as any
    const compiler: any = {
      hooks: {done: {tapAsync: (_name: string, cb: any) => cb({}, () => {})}}
    }
    // Should not throw during apply
    expect(() => step.apply(compiler)).not.toThrow()
  })
})
