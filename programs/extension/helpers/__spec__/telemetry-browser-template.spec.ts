import {describe, expect, it} from 'vitest'
import {TELEMETRY_BROWSERS} from '../telemetry'
import {telemetryBrowserWord} from '../telemetry-cli'
import {DEFAULT_TEMPLATE} from '../template-catalog'
import {SUPPORTED_BROWSER_TARGETS} from '../vendors'
import {cliRun, useTelemetrySandbox} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

const SIX = [
  'chrome',
  'edge',
  'firefox',
  'safari',
  'chromium-based',
  'gecko-based'
]
const WATCH_COMMANDS = ['dev', 'start', 'preview']
const BROWSER_COMMANDS = [...WATCH_COMMANDS, 'build']

// One run of `extension <command> <flags>`, opted in, against the fake sender.
// `resolved` is what the command hands over once it has picked its browsers.
async function sentProperties(
  command: string,
  flags: string[],
  options: {resolved?: string[]; mark?: 'outcome' | 'failure'} = {}
): Promise<Record<string, unknown>> {
  const box = sandbox({env: {EXTENSION_TELEMETRY: '1'}})
  const {cli} = cliRun(box, {argv: ['node', 'extension', command, ...flags]})

  if (options.resolved) cli.noteBrowsers(options.resolved)

  if (options.mark === 'failure') {
    cli.markCommandFailure(command, {code: 'E_ARGS', exitCode: 1})
  } else if (WATCH_COMMANDS.includes(command)) {
    cli.markCommandSessionStart(command)
  } else {
    cli.markCommandSuccess(command)
  }

  await cli.telemetry.flush()

  const rows = box.sentRows()
  expect(rows).toHaveLength(1)
  expect(rows[0].properties.command).toBe(command)

  return rows[0].properties
}

// What the CLI's own family lists make of each resolved name and binary flag.
const CLASSIFIED: Array<[string[], string[], string | undefined]> = [
  [['chrome'], [], 'chrome'],
  [['edge'], [], 'edge'],
  [['firefox'], [], 'firefox'],
  [['safari'], [], 'safari'],
  // The default, and the same name from a flag or the config file.
  [['chromium'], [], 'chromium-based'],
  [['chromium-based'], [], 'chromium-based'],
  [['brave'], [], 'chromium-based'],
  [['opera'], [], 'chromium-based'],
  [['vivaldi'], [], 'chromium-based'],
  [['yandex'], [], 'chromium-based'],
  [['gecko-based'], [], 'gecko-based'],
  [['firefox-based'], [], 'gecko-based'],
  [['waterfox'], [], 'gecko-based'],
  [['librewolf'], [], 'gecko-based'],
  [['zen'], [], 'gecko-based'],
  [['floorp'], [], 'gecko-based'],
  // A custom binary is its engine family, never the path and never the name.
  [
    ['chrome'],
    ['--chromium-binary', '/opt/acme/private-chrome'],
    'chromium-based'
  ],
  [['chromium'], ['--chromium-binary=/opt/acme/thorium'], 'chromium-based'],
  [['firefox'], ['--gecko-binary', '/opt/acme/private-fox'], 'gecko-based'],
  [['firefox'], ['--firefox-binary', '/opt/acme/private-fox'], 'gecko-based'],
  // A binary of the other engine is not the one the run launches.
  [['firefox'], ['--chromium-binary', '/opt/acme/x'], 'firefox'],
  [['edge'], ['--gecko-binary', '/opt/acme/x'], 'edge'],
  // Names with no word in the list, several browsers, or none.
  [['webkit-based'], [], undefined],
  [['chromium-emulator'], [], undefined],
  [['chrome', 'firefox'], [], undefined],
  [['chrome', 'edge', 'firefox'], [], undefined],
  [['/Applications/Acme Browser.app'], [], undefined],
  [['Chrome'], [], undefined],
  [[''], [], undefined],
  [[], [], undefined]
]

describe.each(BROWSER_COMMANDS)('the browser on a %s row', (command) => {
  it.each(
    CLASSIFIED
  )('resolved %j with %j sends %s', async (resolved, flags, expected) => {
    const properties = await sentProperties(command, flags, {resolved})

    if (expected === undefined) {
      expect(properties).not.toHaveProperty('browser')
    } else {
      expect(properties.browser).toBe(expected)
    }

    expect(JSON.stringify(properties)).not.toContain('acme')
    expect(JSON.stringify(properties)).not.toContain('Acme')
  })

  it('rides on a failure row once the browser is resolved', async () => {
    const properties = await sentProperties(command, [], {
      resolved: ['brave'],
      mark: 'failure'
    })

    expect(properties).toMatchObject({
      browser: 'chromium-based',
      code: 'E_ARGS',
      exit_code: 1
    })
  })

  // The flag alone resolves nothing: the config file or a refusal may differ.
  it('is absent from a failure that came before a browser was resolved', async () => {
    expect(
      await sentProperties(command, ['--browser', 'firefox'], {mark: 'failure'})
    ).not.toHaveProperty('browser')
  })
})

describe('the browser property is one of six words or absent', () => {
  it('lists exactly the six', () => {
    expect([...TELEMETRY_BROWSERS]).toEqual(SIX)
  })

  it('gives every target the CLI accepts one of the six or nothing', () => {
    for (const target of SUPPORTED_BROWSER_TARGETS) {
      const word = telemetryBrowserWord(target)

      expect(word === undefined || SIX.includes(word), target).toBe(true)
    }

    expect(
      SUPPORTED_BROWSER_TARGETS.filter(
        (target) => !telemetryBrowserWord(target)
      )
    ).toEqual(['webkit-based', 'chromium-emulator'])
  })

  // A fixed seed, so a failure names a value that fails again.
  function arbitraryValues(count: number): unknown[] {
    let seed = 20261117

    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648

      return seed
    }

    const alphabet =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_/. ,=:'
    const values: unknown[] = []

    for (let i = 0; i < count; i++) {
      let text = ''

      for (let n = next() % 24; n > 0; n--) {
        text += alphabet[next() % alphabet.length]
      }

      values.push(text)
    }

    return values
  }

  const HOSTILE: unknown[] = [
    'brave',
    'chromium',
    'Chrome',
    ' chrome',
    'chrome ',
    'chrome,edge',
    'chrome 131.0.6778.86',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Acme\\browser.exe',
    'https://acme.example/browser',
    'constructor',
    '__proto__',
    '',
    0,
    1,
    true,
    null,
    ['chrome'],
    {toString: () => 'chrome'}
  ]

  it('drops any other value handed straight to the last gate', async () => {
    const box = sandbox()
    const telemetry = box.telemetry({
      sampleRate: 1,
      debounceMs: 0,
      maxEventsPerRun: 10_000
    })
    const values = [...SIX, ...HOSTILE, ...arbitraryValues(500)]

    for (const value of values) {
      telemetry.track('command_failed', {
        command: 'dev',
        success: false,
        version: '9.9.9',
        browser: value as string
      })
    }

    await telemetry.flush()

    const sent = box.sentRows()

    expect(sent).toHaveLength(values.length)

    sent.forEach((row, index) => {
      const value = values[index]

      if (typeof value === 'string' && SIX.includes(value)) {
        expect(row.properties.browser).toBe(value)
      } else {
        expect(row.properties, JSON.stringify(value)).not.toHaveProperty(
          'browser'
        )
      }
    })
  })

  it('drops any other value a command resolved', async () => {
    for (const value of [...HOSTILE, ...arbitraryValues(60)]) {
      const properties = await sentProperties('dev', [], {
        resolved: [String(value)]
      })
      const sent = properties.browser

      expect(
        sent === undefined || SIX.includes(String(sent)),
        String(value)
      ).toBe(true)
    }
  })

  it.each([
    'create',
    'install',
    'telemetry',
    'doctor',
    'unknown'
  ])('is not sent on %s, which resolves no browser for the run', async (command) => {
    expect(
      await sentProperties(command, ['--browser', 'firefox'])
    ).not.toHaveProperty('browser')
  })
})

describe('the starter on a create row', () => {
  it('sends the default starter when --template was not typed', async () => {
    expect(DEFAULT_TEMPLATE).toBe('typescript')
    expect((await sentProperties('create', ['my-extension'])).template).toBe(
      'typescript'
    )
  })

  it.each([
    [['--template', 'typescript']],
    [['--template=typescript']],
    [['-t', 'typescript']]
  ])('sends the same value for an explicit %j', async (flags) => {
    const typed = await sentProperties('create', ['my-extension', ...flags])
    const omitted = await sentProperties('create', ['my-extension'])

    expect(typed.template).toBe(omitted.template)
  })

  it('sends another advertised starter by its name', async () => {
    expect(
      (await sentProperties('create', ['my-extension', '--template', 'react']))
        .template
    ).toBe('react')
  })

  it.each([
    'https://github.com/acme/private-thing',
    '/Users/jane/private/ext',
    '../clients/acme/internal-ext',
    'acme/private-thing',
    'not-a-starter'
  ])('sends no template at all for --template %s', async (freeform) => {
    const properties = await sentProperties('create', [
      'my-extension',
      '--template',
      freeform
    ])

    expect(properties).not.toHaveProperty('template')
    expect(JSON.stringify(properties)).not.toContain('acme')
  })

  it('sends none when --template was typed with no value', async () => {
    expect(
      await sentProperties('create', ['my-extension', '--template'])
    ).not.toHaveProperty('template')
  })

  it('sends the default on a failed create too', async () => {
    expect(
      (await sentProperties('create', ['my-extension'], {mark: 'failure'}))
        .template
    ).toBe('typescript')
  })

  it('adds no template to a command that is not create', async () => {
    expect(await sentProperties('build', [])).not.toHaveProperty('template')
  })
})

// The whole payload of the two rows that gained a property, so a field added
// to either shows up here before it ships.
describe('the rows that carry browser and template, key by key', () => {
  const COMMON = [
    '$geoip_disable',
    '$ip',
    '$process_person_profile',
    'app',
    'arch',
    'command',
    'is_ci',
    'is_source_build',
    'node_major',
    'os',
    'package_manager',
    'success',
    'version'
  ]

  it.each(
    BROWSER_COMMANDS
  )('%s sends the common keys, browser, and for a watch command session', async (command) => {
    const properties = await sentProperties(command, [], {resolved: ['brave']})

    expect(Object.keys(properties).sort()).toEqual(
      [
        ...COMMON,
        'browser',
        ...(WATCH_COMMANDS.includes(command) ? ['session'] : [])
      ].sort()
    )

    expect(properties.browser).toBe('chromium-based')
  })

  it('create sends the common keys, template and source', async () => {
    const properties = await sentProperties('create', ['my-extension'])

    expect(Object.keys(properties).sort()).toEqual(
      [...COMMON, 'source', 'template'].sort()
    )

    expect(properties.template).toBe(DEFAULT_TEMPLATE)
    expect(Object.values(properties)).not.toContain('my-extension')
  })

  it.each([
    ['EXTENSION_TELEMETRY_DISABLED', '1'],
    ['DO_NOT_TRACK', '1']
  ])('sends nothing with %s set, even beside EXTENSION_TELEMETRY=1', async (name, value) => {
    for (const command of [...BROWSER_COMMANDS, 'create']) {
      const box = sandbox({env: {EXTENSION_TELEMETRY: '1', [name]: value}})
      const {cli} = cliRun(box, {
        argv: ['node', 'extension', command, 'my-extension']
      })

      cli.noteBrowsers(['chrome'])

      if (WATCH_COMMANDS.includes(command)) cli.markCommandSessionStart(command)
      else cli.markCommandSuccess(command)

      cli.markCommandFailure(command, {code: 'E_ARGS', exitCode: 1})
      await cli.telemetry.flush()

      expect(box.sentRows(), command).toEqual([])
    }
  })
})
