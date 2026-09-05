import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import {
  cliGeckoBinary,
  firefoxBinaryAliasOption,
  geckoBinaryOption
} from '../cli-options'

function parse(args: string[]) {
  const command = new Command()
    .addOption(geckoBinaryOption())
    .addOption(firefoxBinaryAliasOption())
  command.parse(['node', 'cli', ...args])
  return command.opts()
}

describe('gecko binary option', () => {
  it('reaches the command under the canonical spelling', () => {
    expect(cliGeckoBinary(parse(['--gecko-binary', '/tmp/fox']))).toBe(
      '/tmp/fox'
    )
  })

  it('reaches the command under the firefox spelling', () => {
    expect(cliGeckoBinary(parse(['--firefox-binary', '/tmp/fox']))).toBe(
      '/tmp/fox'
    )
  })

  it('advertises one name and hides the alias', () => {
    expect(geckoBinaryOption().hidden).toBe(false)
    expect(firefoxBinaryAliasOption().hidden).toBe(true)
    expect(cliGeckoBinary(parse([]))).toBeUndefined()
  })
})
