import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

// Every command that runs the develop pipeline has to tell it that stdout
// belongs to a machine, or the pipeline's human lines land in the middle of the
// envelope stream. build, preview and start did this and dev did not, so
// `dev --output json` shipped 10 prose lines on stdout and an empty stderr,
// breaking the exact contract the docs hand to agents and CI.
const PIPELINE_COMMANDS = ['dev', 'build', 'start', 'preview'] as const

function commandSource(name: string): string {
  return fs.readFileSync(
    path.resolve(__dirname, '..', 'commands', `${name}.ts`),
    'utf8'
  )
}

describe('machine output routing', () => {
  it.each(
    PIPELINE_COMMANDS
  )('%s routes human copy to stderr under --output json', (name) => {
    const source = commandSource(name)
    expect(
      source,
      `${name} must set EXTENSION_OUTPUT=json so develop's human sinks go quiet`
    ).toMatch(/process\.env\.EXTENSION_OUTPUT\s*=\s*'json'/)
  })

  it('sets it from the resolved json flag, not unconditionally', () => {
    for (const name of PIPELINE_COMMANDS) {
      const source = commandSource(name)
      expect(source).toMatch(
        /if \(asJson\) process\.env\.EXTENSION_OUTPUT = 'json'/
      )
    }
  })
})
