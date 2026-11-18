import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  isTelemetryErrorClass,
  telemetryErrorClass
} from '../telemetry-error-class'
import {cliRun, useTelemetrySandbox} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

// A person's folder, the kind of text a message carries and a row must not.
const PRIVATE_FOLDER = path.join('C:', 'Users', 'Zoë Ångström', 'my project')

class TemplateCopyError extends Error {}

function systemError(code: string): Error {
  return Object.assign(
    new Error(`${code}: operation failed, open '${PRIVATE_FOLDER}'`),
    {code, errno: -2, syscall: 'open', path: PRIVATE_FOLDER}
  )
}

async function failedRow(details: Record<string, unknown>) {
  const box = sandbox({env: {EXTENSION_TELEMETRY: '1'}})
  const {cli} = cliRun(box, {argv: ['node', 'extension', 'dev']})

  cli.markCommandFailure(undefined, {exitCode: 1, ...details})
  await cli.telemetry.flush()

  const rows = box.sentRows()
  expect(rows).toHaveLength(1)
  expect(rows[0].event).toBe('command_failed')

  return {row: rows[0], wire: JSON.stringify(box.sent)}
}

describe('the class of an error, as one word from a fixed list', () => {
  it.each([
    [new TypeError('x'), 'TypeError'],
    [new RangeError('x'), 'RangeError'],
    [new SyntaxError('x'), 'SyntaxError'],
    [new Error('x'), 'Error'],
    [new AggregateError([], 'x'), 'AggregateError'],
    [systemError('ENOENT'), 'ENOENT'],
    [systemError('EPERM'), 'EPERM'],
    [
      systemError('ERR_UNSUPPORTED_ESM_URL_SCHEME'),
      'ERR_UNSUPPORTED_ESM_URL_SCHEME'
    ],
    [systemError('ERR_DLOPEN_FAILED'), 'ERR_DLOPEN_FAILED'],
    [systemError('ERR_SOME_PACKAGE_MADE_THIS_UP'), 'Error'],
    [new TemplateCopyError('x'), 'other'],
    [Object.assign(new Error('x'), {name: 'TemplateNotFoundError'}), 'other'],
    [Object.assign(new Error('x'), {code: 'my private code'}), 'Error'],
    ['a thrown string', 'other'],
    [undefined, 'other']
  ])('reads %s as %s', (error, word) => {
    expect(telemetryErrorClass(error)).toBe(word)
    expect(isTelemetryErrorClass(word)).toBe(true)
  })

  it('refuses free text as a class', () => {
    expect(isTelemetryErrorClass('TemplateCopyError')).toBe(false)
    expect(isTelemetryErrorClass(PRIVATE_FOLDER)).toBe(false)
    expect(isTelemetryErrorClass('ERR_ with a space')).toBe(false)
    expect(isTelemetryErrorClass('ERR_SOME_PACKAGE_MADE_THIS_UP')).toBe(false)
  })
})

describe('an E_INTERNAL row names the error class and the step', () => {
  it('sends a thrown TypeError as its name, with the step', async () => {
    const {row} = await failedRow({
      code: 'E_INTERNAL',
      error: new TypeError("Cannot read properties of undefined (reading 'x')"),
      step: 'engine'
    })

    expect(row.properties).toMatchObject({
      code: 'E_INTERNAL',
      error_class: 'TypeError',
      error_step: 'engine'
    })
  })

  it('sends a custom class as other', async () => {
    const {row} = await failedRow({
      code: 'E_INTERNAL',
      error: new TemplateCopyError('x'),
      step: 'scaffold'
    })

    expect(row.properties.error_class).toBe('other')
  })

  it('sends a Node system error as its system code', async () => {
    const {row} = await failedRow({
      code: 'E_INTERNAL',
      error: systemError('EBUSY'),
      step: 'action'
    })

    expect(row.properties.error_class).toBe('EBUSY')
  })

  it('sends no part of a message, a path or a stack', async () => {
    const {wire} = await failedRow({
      code: 'E_INTERNAL',
      error: systemError('ENOENT'),
      step: 'engine_load'
    })

    for (const piece of ['Zoë', 'Ångström', 'my project', 'operation failed']) {
      expect(wire).not.toContain(piece)
    }

    expect(wire).not.toMatch(/\bat \w/)
  })

  it('drops a step outside the fixed list', async () => {
    const {row} = await failedRow({
      code: 'E_INTERNAL',
      error: new TypeError('x'),
      step: 'loadConfig (C:\\Users\\someone\\index.js:3:1)'
    })

    expect(row.properties.error_class).toBe('TypeError')
    expect(row.properties).not.toHaveProperty('error_step')
  })

  it('adds neither to a row with any other code', async () => {
    const {row} = await failedRow({
      code: 'E_COMPILE',
      error: new TypeError('x'),
      step: 'engine'
    })

    expect(row.properties).not.toHaveProperty('error_class')
    expect(row.properties).not.toHaveProperty('error_step')
  })

  it('sends no class for an E_INTERNAL row with no error to read', async () => {
    const {row} = await failedRow({code: 'E_INTERNAL', step: 'action'})

    expect(row.properties).not.toHaveProperty('error_class')
    expect(row.properties.error_step).toBe('action')
  })
})
