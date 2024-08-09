import {transformSource} from '../../../steps/transform-source'
import {parse} from 'acorn'

// TODO: cezaruaugusto - Fix the tests
describe.skip('transformSource Tests', () => {
  const transformAndParse = (code: string) => {
    const transformedCode = transformSource(code, {
      typescript: false,
      jsx: false
    })
    return parse(transformedCode, {ecmaVersion: 'latest', sourceType: 'module'})
  }

  test('should transform chrome.action.setIcon', () => {
    const code = `chrome.action.setIcon({ path: 'icon.png' });`
    const ast = transformAndParse(code)
    const firstArg = (ast.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.action.setPopup', () => {
    const code = `chrome.action.setPopup({ popup: 'popup.html' });`
    const ast = transformAndParse(code)
    const firstArg = (ast.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.devtools.panels.create', () => {
    const code = `chrome.devtools.panels.create('My Panel', 'icon.png', 'panel.html');`
    const ast = transformAndParse(code)
    const secondArg = (ast.body[0] as any).expression.arguments[1]
    expect(secondArg.type).toBe('CallExpression')
    expect(secondArg.callee.name).toBe('r.solve')
    const thirdArg = (ast.body[0] as any).expression.arguments[2]
    expect(thirdArg.type).toBe('CallExpression')
    expect(thirdArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.runtime.getURL', () => {
    const code = `chrome.runtime.getURL('popup.html');`
    const ast = transformAndParse(code)
    const firstArg = (ast.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.tabs.create', () => {
    const code = `chrome.tabs.create({ url: 'https://google.com' });`
    const ast = transformAndParse(code)
    const firstArg = (ast.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.sidePanel.setOptions', () => {
    const code = `chrome.sidePanel.setOptions({ title: 'My Panel' });`
    const ast = transformAndParse(code)
    const firstArg = (ast.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.windows.create when URL argument is an array', () => {
    const code = `chrome.windows.create({url: ['https://www.extension.js.org/']});`
    const ast = transformAndParse(code)
    const firstArg = (ast.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.windows.create when URL argument is a string', () => {
    const code = `chrome.windows.create({url: 'https://www.extension.js.org/'});`
    const ast = transformAndParse(code)
    const firstArg = (ast.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })
})
