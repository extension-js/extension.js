import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  commandFromArgv,
  reportUnsupportedRuntimeWith
} from '../runtime-refusal-telemetry'
import type {TelemetryEnv} from '../telemetry'
import {readRows, type Sandbox, useTelemetrySandbox} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

function refuse(argv: string[], env: TelemetryEnv = {}, stored?: string) {
  const box = sandbox({env})

  if (stored) {
    fs.mkdirSync(box.configDir, {recursive: true})
    fs.writeFileSync(path.join(box.configDir, 'consent'), stored)
  }

  reportUnsupportedRuntimeWith(['node', 'extension', ...argv], {
    ...box.deps,
    version: '4.1.41'
  })

  return box
}

function crashRows(box: Sandbox) {
  return box.crashSent.flatMap((send) => send.rows)
}

describe('an unsupported runtime is reported before the guard exits', () => {
  it('sends one coded failure on a machine that agreed to telemetry', () => {
    const box = refuse(['dev'], {EXTENSION_TELEMETRY: '1'})

    expect(box.crashSent.map((send) => send.budgetMs)).toEqual([1500])
    expect(crashRows(box).map((row) => [row.event, row.properties])).toEqual([
      [
        'command_failed',
        expect.objectContaining({
          command: 'dev',
          success: false,
          version: '4.1.41',
          code: 'E_NODE_VERSION',
          exit_code: 1
        })
      ]
    ])

    // The same row is in the local audit, where its owner can read it.
    expect(
      readRows(path.join(box.configDir, 'events.jsonl')).map(
        (row) => row.properties.code
      )
    ).toEqual(['E_NODE_VERSION'])
  })

  it('reports a machine whose stored consent says enabled', () => {
    expect(crashRows(refuse(['build'], {}, 'enabled'))).toHaveLength(1)
  })

  it('reads a verb it does not know as unknown, never as typed', () => {
    const box = refuse(['./my-private-project'], {EXTENSION_TELEMETRY: '1'})

    expect(crashRows(box)[0].properties.command).toBe('unknown')
    expect(JSON.stringify(box.crashSent)).not.toContain('my-private-project')
  })

  it.each<[string, string[], TelemetryEnv, string | undefined]>([
    ['before the first-run notice has been shown', ['dev'], {}, undefined],
    [
      'when telemetry is turned off',
      ['dev'],
      {EXTENSION_TELEMETRY: '0'},
      undefined
    ],
    [
      'when the flag turns it off',
      ['dev', '--no-telemetry'],
      {EXTENSION_TELEMETRY: '1'},
      undefined
    ],
    ['when a stored refusal says so', ['dev'], {}, 'disabled'],
    ['in a pipeline that never agreed', ['dev'], {CI: '1'}, 'enabled']
  ])('sends nothing %s', (_name, argv, env, stored) => {
    const box = refuse(argv, env, stored)

    expect(box.crashSent).toEqual([])
    expect(fs.existsSync(path.join(box.configDir, 'events.jsonl'))).toBe(false)
  })

  it('swallows a sender that throws, so the guard still exits', () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY: '1'}})

    expect(() =>
      reportUnsupportedRuntimeWith(['node', 'extension', 'dev'], {
        ...box.deps,
        version: '4.1.41',
        sendSync: () => {
          throw new Error('spawn ENOMEM')
        }
      })
    ).not.toThrow()
  })
})

describe('the verb the guard reads', () => {
  it.each<[string[], string]>([
    [['node', 'extension', 'build'], 'build'],
    [['node', 'extension', '--output', 'json', 'dev'], 'dev'],
    [['node', 'extension', '--output=json', 'dev'], 'dev'],
    [['node', 'extension', '--browser', 'firefox', 'build'], 'build'],
    [['node', 'extension', '--browser=firefox', 'safari', 'enable'], 'safari'],
    [['node', 'extension', './my-project'], 'extension'],
    [['node', 'extension'], 'extension'],
    [['node', 'extension', '--help'], 'extension']
  ])('reads %j as %s', (argv, verb) => {
    expect(commandFromArgv(argv)).toBe(verb)
  })
})
