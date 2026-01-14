import {describe, it, expect} from 'vitest'
import {programAIHelp} from '../messages'

describe('programAIHelp', () => {
  it('includes Managed Dependencies guidance', () => {
    const help = programAIHelp()
    expect(help).toMatch(/Managed Dependencies \(Important\)/)
    expect(help).toMatch(/do not add/i)
    expect(help).toMatch(/print an error and abort/i)
  })
})
