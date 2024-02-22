import {has} from '../../../steps/transformSource/checkApiExists'
import * as t from '@babel/types'

describe('API Check Tests', () => {
  test('should identify chrome.action.setIcon', () => {
    const callee: any = t.memberExpression(
      t.memberExpression(t.identifier('chrome'), t.identifier('action')),
      t.identifier('setIcon')
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    expect(has(callee, 'chrome.action.setIcon')).toBe(true)
  })

  test('should identify chrome.action.setPopup', () => {
    const callee: any = t.memberExpression(
      t.memberExpression(t.identifier('chrome'), t.identifier('action')),
      t.identifier('setPopup')
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    expect(has(callee, 'chrome.action.setPopup')).toBe(true)
  })

  test('should identify chrome.runtime.getURL', () => {
    const callee: any = t.memberExpression(
      t.memberExpression(t.identifier('chrome'), t.identifier('runtime')),
      t.identifier('getURL')
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    expect(has(callee, 'chrome.runtime.getURL')).toBe(true)
  })

  test('should identify chrome.devtools.panels.create', () => {
    const callee: any = t.memberExpression(
      t.memberExpression(
        t.memberExpression(t.identifier('chrome'), t.identifier('devtools')),
        t.identifier('panels')
      ),
      t.identifier('create')
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    expect(has(callee, 'chrome.devtools.panels.create')).toBe(true)
  })
})
