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
async function sentProperties(
  command: string,
  flags: string[],
  mark: 'outcome' | 'failure' = 'outcome'
): Promise<Record<string, unknown>> {
  const box = sandbox({env: {EXTENSION_TELEMETRY: '1'}})
  const {cli} = cliRun(box, {argv: ['node', 'extension', command, ...flags]})

  if (mark === 'failure') {
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

// What the CLI's own family lists make of each name, fork and binary.
const CLASSIFIED: Array<[string[], string | undefined]> = [
  [['--browser', 'chrome'], 'chrome'],
  [['--browser=edge'], 'edge'],
  [['--browser', 'firefox'], 'firefox'],
  [['--browser', 'safari'], 'safari'],
  [['--browser', 'chromium'], 'chromium-based'],
  [['--browser', 'chromium-based'], 'chromium-based'],
  [['--browser', 'brave'], 'chromium-based'],
  [['--browser', 'opera'], 'chromium-based'],
  [['--browser', 'vivaldi'], 'chromium-based'],
  [['--browser', 'yandex'], 'chromium-based'],
  [['--browser', 'gecko-based'], 'gecko-based'],
  [['--browser', 'firefox-based'], 'gecko-based'],
  [['--browser', 'waterfox'], 'gecko-based'],
  [['--browser', 'librewolf'], 'gecko-based'],
  [['--browser', 'zen'], 'gecko-based'],
  [['--browser', 'floorp'], 'gecko-based'],
  // A custom binary is its engine family, never the path and never the name.
  [
    ['--browser', 'chrome', '--chromium-binary', '/opt/acme/private-chrome'],
    'chromium-based'
  ],
  [
    ['--browser', 'chromium-based', '--chromium-binary=/opt/acme/thorium'],
    'chromium-based'
  ],
  [
    ['--browser', 'firefox', '--gecko-binary', '/opt/acme/private-fox'],
    'gecko-based'
  ],
  [
    ['--browser', 'firefox', '--firefox-binary', '/opt/acme/private-fox'],
    'gecko-based'
  ],
  // A binary of the other engine is not the one the run launches.
  [['--browser', 'firefox', '--chromium-binary', '/opt/acme/x'], 'firefox'],
  [['--browser', 'edge', '--gecko-binary', '/opt/acme/x'], 'edge'],
  // Names with no word in the list, several browsers, or none typed.
  [['--browser', 'webkit-based'], undefined],
  [['--browser', 'chromium-emulator'], undefined],
  [['--browser', 'chrome,firefox'], undefined],
  [['--browser', 'all'], undefined],
  [['--browser', '/Applications/Acme Browser.app'], undefined],
  [['--browser', 'Chrome'], undefined],
  [['--chromium-binary', '/opt/acme/private-chrome'], undefined],
  [[], undefined]
]

describe.each(BROWSER_COMMANDS)('the browser on a %s row', (command) => {
  it.each(CLASSIFIED)('%j sends %s', async (flags, expected) => {
    const properties = await sentProperties(command, flags)

    if (expected === undefined) {
      expect(properties).not.toHaveProperty('browser')
    } else {
      expect(properties.browser).toBe(expected)
    }

    expect(JSON.stringify(properties)).not.toContain('acme')
    expect(JSON.stringify(properties)).not.toContain('Acme')
  })

  it('rides on a failure row too', async () => {
    const properties = await sentProperties(
      command,
      ['--browser', 'brave'],
      'failure'
    )

    expect(properties).toMatchObject({
      browser: 'chromium-based',
      code: 'E_ARGS',
      exit_code: 1
    })
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

  it('drops any other value typed after --browser', async () => {
    for (const value of [...HOSTILE, ...arbitraryValues(60)]) {
      const properties = await sentProperties('dev', [
        '--browser',
        String(value)
      ])
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
  ])('is not sent on %s, which launches no browser of its own', async (command) => {
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
      (await sentProperties('create', ['my-extension'], 'failure')).template
    ).toBe('typescript')
  })

  it('adds no template to a command that is not create', async () => {
    expect(await sentProperties('build', [])).not.toHaveProperty('template')
  })
})
