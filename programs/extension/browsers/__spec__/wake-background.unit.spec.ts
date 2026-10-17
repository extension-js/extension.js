import {describe, expect, it} from 'vitest'
import {
  wakeBackgroundExpression,
  wakeThroughParentProcess
} from '../run-firefox/rdp/evaluate-extension-document'

const ADDON_ID = 'repro@extension.js'

function fakeClient(answer: unknown) {
  const requests: Array<Record<string, unknown>> = []
  const evaluated: Array<{actor: string; expression: string}> = []

  return {
    requests,
    evaluated,
    client: {
      request: async (payload: Record<string, unknown>) => {
        requests.push(payload)

        if (payload.type === 'getProcess') {
          return {processDescriptor: {actor: 'process-descriptor'}}
        }

        if (payload.type === 'getTarget') {
          return {process: {consoleActor: 'parent-console'}}
        }

        return {}
      },
      evaluate: async (actor: string, expression: string) => {
        evaluated.push({actor, expression})

        return answer
      },
      on: () => undefined
    }
  }
}

// A suspended event page has no document for a console to evaluate in, so
// the wake is asked of the parent process, which holds the extension.
describe('waking a suspended Firefox background over the debugger', () => {
  it('asks the parent process to start the add-on background', async () => {
    const fake = fakeClient('woken')

    await expect(
      wakeThroughParentProcess({client: fake.client, extensionId: ADDON_ID})
    ).resolves.toBe(true)

    expect(fake.requests[0]).toEqual({to: 'root', type: 'getProcess', id: 0})
    expect(fake.requests[1]).toEqual({
      to: 'process-descriptor',
      type: 'getTarget'
    })

    expect(fake.evaluated).toEqual([
      {actor: 'parent-console', expression: wakeBackgroundExpression(ADDON_ID)}
    ])

    expect(fake.evaluated[0].expression).toContain('wakeupBackground')
    expect(fake.evaluated[0].expression).toContain(JSON.stringify(ADDON_ID))
  })

  it('answers false when Firefox does not hold the add-on', async () => {
    const fake = fakeClient('no-extension')

    await expect(
      wakeThroughParentProcess({client: fake.client, extensionId: ADDON_ID})
    ).resolves.toBe(false)
  })
})
