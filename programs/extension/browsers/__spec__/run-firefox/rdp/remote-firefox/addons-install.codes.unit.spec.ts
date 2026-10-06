import {describe, expect, it} from 'vitest'
import {installTemporaryAddon} from '../../../../run-firefox/rdp/remote-firefox/addons-install'
import type {MessagingClient} from '../../../../run-firefox/rdp/remote-firefox/messaging-client'

function clientThatRejectsWith(error: unknown): MessagingClient {
  return {
    request: async () => {
      throw error
    }
  } as unknown as MessagingClient
}

describe('the temporary add-on install names its failure class', () => {
  it('codes a session with no addons actor as E_ADDON_INSTALL', async () => {
    const client = clientThatRejectsWith(new Error('never asked'))

    await expect(
      installTemporaryAddon(client, '', '/tmp/dist/firefox', false)
    ).rejects.toMatchObject({code: 'E_ADDON_INSTALL'})
  })

  it('keeps the code of a wire that died under the install request', async () => {
    const closed = Object.assign(new Error('socket closed'), {
      code: 'E_BROWSER_CONNECTION_CLOSED'
    })

    await expect(
      installTemporaryAddon(
        clientThatRejectsWith(closed),
        'server1.conn1.addonsActor1',
        '/tmp/dist/firefox',
        false
      )
    ).rejects.toMatchObject({code: 'E_BROWSER_CONNECTION_CLOSED'})
  })
})
