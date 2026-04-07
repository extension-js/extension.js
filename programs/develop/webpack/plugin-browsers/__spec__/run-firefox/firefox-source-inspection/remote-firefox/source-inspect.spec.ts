import {describe, expect, it, vi} from 'vitest'
import {getPageHTML} from '../../../../run-firefox/firefox-source-inspection/remote-firefox/source-inspect'

describe('remote-firefox source inspect helpers', () => {
  it('delegates html extraction to the messaging client when available', async () => {
    const client = {
      getPageHTML: vi.fn(async () => '<html><body>delegated</body></html>')
    }

    await expect(
      getPageHTML(client as any, 'tab-descriptor', 'console-actor')
    ).resolves.toBe('<html><body>delegated</body></html>')

    expect(client.getPageHTML).toHaveBeenCalledWith(
      'tab-descriptor',
      'console-actor'
    )
  })
})
