import {describe, expect, it} from 'vitest'
import {closeUtilityTab} from '../../run-chromium/cdp/close-utility-tab'

type Target = {targetId: string; type: string}

function transportWith(
  targets: Target[] | Error,
  created: {targetId?: string} = {targetId: 'kept'}
) {
  const calls: string[] = []

  return {
    calls,
    transport: {
      async sendCommand(method: string, params?: Record<string, unknown>) {
        if (method === 'Target.getTargets') {
          calls.push('list')
          if (targets instanceof Error) throw targets

          return {targetInfos: targets}
        }

        if (method === 'Target.createTarget') {
          calls.push(`create ${params?.url}`)

          return created
        }

        calls.push(`close ${params?.targetId}`)

        return {}
      }
    }
  }
}

// Seen on the nightly Edge lane, on the first launch of a cold machine: the
// tab opened to switch developer mode on was the only tab, and closing it
// made the browser quit with exit code 0.
describe('closing a tab this session opened for itself', () => {
  it('opens a new tab page first when that tab is the only one', async () => {
    const {transport, calls} = transportWith([
      {targetId: 'mine', type: 'page'},
      {targetId: 'worker', type: 'service_worker'}
    ])

    await closeUtilityTab(transport, 'mine')

    expect(calls).toEqual(['list', 'create chrome://newtab/', 'close mine'])
  })

  it('leaves the tab open when no other tab could be opened', async () => {
    const {transport, calls} = transportWith(
      [{targetId: 'mine', type: 'page'}],
      {}
    )

    await closeUtilityTab(transport, 'mine')

    expect(calls).toEqual(['list', 'create chrome://newtab/'])
  })

  it('only closes the tab while another tab is open', async () => {
    const {transport, calls} = transportWith([
      {targetId: 'mine', type: 'page'},
      {targetId: 'start', type: 'page'}
    ])

    await closeUtilityTab(transport, 'mine')

    expect(calls).toEqual(['list', 'close mine'])
  })

  it.each([
    {name: 'a list that cannot be read', targets: new Error('no answer')},
    {name: 'a list with no tab in it', targets: [] as Target[]}
  ])('closes the tab on $name', async ({targets}) => {
    const {transport, calls} = transportWith(targets)

    await closeUtilityTab(transport, 'mine')

    expect(calls).toEqual(['list', 'close mine'])
  })
})
