import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {ensureRustMinStack, RUST_MIN_STACK_BYTES} from '../rust-min-stack'

// The published ExtensionEnv augmentation makes the bundler-injected keys
// required, and a unit env object carries none of them.
const asEnv = (vars: Record<string, string> = {}) => vars as NodeJS.ProcessEnv

describe('ensureRustMinStack', () => {
  it('sets RUST_MIN_STACK when unset', () => {
    const env = asEnv()
    ensureRustMinStack(env)
    expect(env.RUST_MIN_STACK).toBe(String(RUST_MIN_STACK_BYTES))
  })

  it('respects a user-provided RUST_MIN_STACK', () => {
    const env = asEnv({RUST_MIN_STACK: '8388608'})
    ensureRustMinStack(env)
    expect(env.RUST_MIN_STACK).toBe('8388608')
  })

  it('treats an empty string as unset (empty getenv is useless to Rust)', () => {
    const env = asEnv({RUST_MIN_STACK: ''})
    ensureRustMinStack(env)
    expect(env.RUST_MIN_STACK).toBe(String(RUST_MIN_STACK_BYTES))
  })

  it('is called by module.ts before the first module that reaches rspack', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'module.ts'),
      'utf8'
    )
    const call = source.search(/^ensureRustMinStack\(\)$/m)
    const firstLoad = source.indexOf('import(')

    expect(call).toBeGreaterThan(-1)
    expect(firstLoad).toBeGreaterThan(call)

    // A static import is hoisted above the call, so only types and the guard
    // itself may be imported that way.
    const staticValueImports = [
      ...source.matchAll(/^import (?!type\b)[^'"]*['"]([^'"]+)['"]/gm)
    ].map((match) => match[1])
    expect(staticValueImports).toEqual(['./lib/rust-min-stack'])
    expect(source).not.toMatch(/^export [^'"\n]* from /m)
  })
})
