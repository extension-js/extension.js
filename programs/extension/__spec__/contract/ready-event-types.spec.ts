import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {programAIHelpJSON} from '../../helpers/messages'
import {READY_EVENT_TYPES} from '../../helpers/ready-contract-codes'

const here = path.dirname(fileURLToPath(import.meta.url))
const writerPath = path.resolve(
  here,
  '../../../develop/plugin-ready-contract/index.ts'
)

// The engine declares the events it writes as a type, which no runtime can
// read, so this reads the union off the source the way a reviewer would.
function eventTypesTheWriterDeclares(): string[] {
  const source = fs.readFileSync(writerPath, 'utf8').replace(/\r\n/g, '\n')
  const declared = source.indexOf('export type ReadyContractEvent = {')

  expect(declared).toBeGreaterThan(-1)

  const body = source.slice(declared)
  const union = body.slice(
    body.indexOf('type:'),
    body.indexOf('\n  ts: string')
  )

  return Array.from(union.matchAll(/'([a-z_]+)'/g), (m) => m[1])
}

describe('events.ndjson event names', () => {
  it('the CLI lists every event the engine writes, and no other', () => {
    const written = eventTypesTheWriterDeclares()

    expect(written.length).toBeGreaterThanOrEqual(6)
    expect([...READY_EVENT_TYPES].sort()).toEqual([...written].sort())
  })

  it('--ai-help answers with that same list', () => {
    const {readyContract} = programAIHelpJSON('0.0.0').capabilities

    expect(readyContract.eventTypes).toEqual([...READY_EVENT_TYPES])
    expect(readyContract.eventTypes).toContain('browser_exited')
    expect(readyContract.eventTypes).toContain('browser_launch_failed')
  })
})
