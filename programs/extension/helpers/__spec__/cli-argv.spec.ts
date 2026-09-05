import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import {
  collectValuedLongFlags,
  resolveCommandFromArgv,
  rewriteOutputAliasArgv,
  scanArgvValue
} from '../cli-argv'

const argv = (...rest: string[]) => ['node', 'cli', ...rest]

describe('resolveCommandFromArgv', () => {
  const valued = new Set(['--format', '--output', '--port'])

  it('skips the value of a flag that takes one', () => {
    expect(
      resolveCommandFromArgv(argv('--format', 'json', 'dev', './src'), valued)
    ).toBe('dev')
    expect(
      resolveCommandFromArgv(argv('--port', '9000', 'start'), valued)
    ).toBe('start')
  })

  it('keeps reading an equals-form flag as one token', () => {
    expect(resolveCommandFromArgv(argv('--format=json', 'dev'), valued)).toBe(
      'dev'
    )
  })

  it('does not skip after a boolean flag', () => {
    expect(
      resolveCommandFromArgv(argv('--no-telemetry', 'build'), valued)
    ).toBe('build')
  })

  it('returns nothing when only flags are present', () => {
    expect(
      resolveCommandFromArgv(argv('--format', 'json'), valued)
    ).toBeUndefined()
  })
})

describe('collectValuedLongFlags', () => {
  it('gathers value-taking flags from the program and its commands', () => {
    const program = new Command()
    program.option('--format <fmt>').option('--no-telemetry')
    program.command('dev').option('--output <fmt>').option('--port <n>')
    program.command('build').option('--zip')
    const flags = collectValuedLongFlags(program)
    expect([...flags].sort()).toEqual(['--format', '--output', '--port'])
  })
})

describe('rewriteOutputAliasArgv', () => {
  const valued = new Set(['--format', '--output'])

  it('rewrites a trailing alias in place', () => {
    const {argv: next, rewritten} = rewriteOutputAliasArgv(
      argv('build', './src', '--format', 'json'),
      valued
    )
    expect(rewritten).toBe(true)
    expect(next).toEqual(argv('build', './src', '--output', 'json'))
  })

  it('rewrites the equals form', () => {
    const {argv: next} = rewriteOutputAliasArgv(
      argv('build', '--format=json'),
      valued
    )
    expect(next).toEqual(argv('build', '--output=json'))
  })

  it('moves a pre-command alias behind the command so the command parses it', () => {
    const {argv: next} = rewriteOutputAliasArgv(
      argv('--format', 'json', 'dev', './src', '--no-reload'),
      valued
    )
    expect(next).toEqual(
      argv('dev', '--output', 'json', './src', '--no-reload')
    )
    expect(resolveCommandFromArgv(next, valued)).toBe('dev')
  })

  it('leaves argv untouched without the alias', () => {
    const input = argv('dev', '--output', 'json')
    const {argv: next, rewritten} = rewriteOutputAliasArgv(input, valued)
    expect(rewritten).toBe(false)
    expect(next).toBe(input)
  })
})

describe('scanArgvValue', () => {
  it('reads both spellings', () => {
    expect(scanArgvValue(argv('--output', 'json'), '--output')).toBe('json')
    expect(scanArgvValue(argv('--output=JSON'), '--output')).toBe('JSON')
    expect(scanArgvValue(argv('dev'), '--output')).toBeUndefined()
  })
})
