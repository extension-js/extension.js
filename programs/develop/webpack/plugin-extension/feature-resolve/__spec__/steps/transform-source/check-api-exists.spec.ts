import {parse, Node} from 'acorn'
import {has} from '../../../steps/transform-source/check-api-exists'

describe('API Check Tests', () => {
  const parseExpression = (code: string): Node => {
    const ast = parse(code, {ecmaVersion: 'latest', sourceType: 'module'})
    const statement = ast.body[0]

    if (statement.type === 'ExpressionStatement') {
      return statement.expression
    }

    throw new Error('Parsed AST is not an expression')
  }

  test('should identify chrome.action.setIcon', () => {
    const callee: any = parseExpression('chrome.action.setIcon')
    expect(has(callee, 'chrome.action.setIcon')).toBe(true)
  })

  test('should identify chrome.action.setPopup', () => {
    const callee: any = parseExpression('chrome.action.setPopup')
    expect(has(callee, 'chrome.action.setPopup')).toBe(true)
  })

  test('should identify chrome.runtime.getURL', () => {
    const callee: any = parseExpression('chrome.runtime.getURL')
    expect(has(callee, 'chrome.runtime.getURL')).toBe(true)
  })

  test('should identify chrome.devtools.panels.create', () => {
    const callee: any = parseExpression('chrome.devtools.panels.create')
    expect(has(callee, 'chrome.devtools.panels.create')).toBe(true)
  })

  test('should not identify chrome.runtime.nonExistentMethod', () => {
    const callee: any = parseExpression('chrome.runtime.someOtherMethod')
    expect(has(callee, 'chrome.runtime.nonExistentMethod')).toBe(false)
  })

  test('should not identify an invalid chain', () => {
    const callee: any = parseExpression('chrome.action.setIcon')
    expect(has(callee, 'chrome.runtime.setIcon')).toBe(false)
  })
})
