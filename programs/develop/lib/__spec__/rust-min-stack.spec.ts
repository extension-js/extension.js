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

  it('runs on import (importing this spec already set process.env)', () => {
    expect(process.env.RUST_MIN_STACK).toBeTruthy()
  })

  it('stays the first import of module.ts. It must run before anything transitively loads @rspack/core', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'module.ts'),
      'utf8'
    )
    const firstImport = source.match(/^import .*$/m)
    expect(firstImport?.[0]).toBe("import './lib/rust-min-stack'")
  })
})
