import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  claimCardKey,
  holdCardKey,
  isCardKeyClaimed,
  releaseCardKeysOf
} from '../messaging'

const ENV = 'EXTENSION_CLI_CARD_KEYS'
let saved: string | undefined

beforeEach(() => {
  saved = process.env[ENV]
  delete process.env[ENV]
})

afterEach(() => {
  if (saved === undefined) delete process.env[ENV]
  else process.env[ENV] = saved
})

describe('identity card keys', () => {
  const chrome = path.resolve('/work/a/dist/chrome')
  const firefox = path.resolve('/work/a/dist/firefox')

  it('leaves nothing in the environment once the last session gives its card back', () => {
    expect(claimCardKey(`chrome::${chrome}`)).toBe(true)

    releaseCardKeysOf(chrome)

    expect(Object.prototype.hasOwnProperty.call(process.env, ENV)).toBe(false)
    expect(isCardKeyClaimed(`chrome::${chrome}`)).toBe(false)
    expect(claimCardKey(`chrome::${chrome}`)).toBe(true)
  })

  it('keeps the card of another output folder', () => {
    claimCardKey(`chrome::${chrome}`)
    claimCardKey(`firefox::${firefox}`)

    releaseCardKeysOf(chrome)

    expect(isCardKeyClaimed(`chrome::${chrome}`)).toBe(false)
    expect(isCardKeyClaimed(`firefox::${firefox}`)).toBe(true)
  })

  it('hands the release back with the claim, and nothing when it is taken', () => {
    const release = holdCardKey(`chrome::${chrome}`)

    expect(release).toBeTypeOf('function')
    expect(holdCardKey(`chrome::${chrome}`)).toBeUndefined()

    claimCardKey(`firefox::${firefox}`)
    release?.()

    expect(isCardKeyClaimed(`chrome::${chrome}`)).toBe(false)
    expect(isCardKeyClaimed(`firefox::${firefox}`)).toBe(true)
  })

  it('does not take back a card claimed again after its release', () => {
    const release = holdCardKey(`chrome::${chrome}`)

    release?.()
    claimCardKey(`chrome::${chrome}`)
    release?.()

    expect(isCardKeyClaimed(`chrome::${chrome}`)).toBe(true)
  })
})
