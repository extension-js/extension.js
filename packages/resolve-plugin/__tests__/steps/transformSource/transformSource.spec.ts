import transformSource from '../../../steps/transformSource'
import {parse} from '@babel/parser'

const resolverRelativePath = 'resolver-module.js'
describe('transformSource Tests', () => {
  test('should transform chrome.action.setIcon', () => {
    const code = `chrome.action.setIcon({ path: 'icon.png' });`
    const ast = parse(code)
    transformSource(ast, code)
    // Check if the first argument of the first expression is a call to resolvePath
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.action.setPopup', () => {
    const code = `chrome.action.setPopup({ popup: 'popup.html' });`
    const ast = parse(code)
    transformSource(ast, code)
    // Check if the first argument of the first expression is a call to resolvePopup
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })

  // devtools
  test('should transform chrome.devtools.panels.create', () => {
    const code = `chrome.devtools.panels.create('My Panel', 'icon.png', 'panel.html');`
    const ast = parse(code)
    transformSource(ast, code)
    // Check if the first argument of the first expression is a call to resolveString
    const secondArg = (ast.program.body[0] as any).expression.arguments[1]
    expect(secondArg.type).toBe('CallExpression')
    expect(secondArg.callee.name).toBe('r.solve')
    const thirdArg = (ast.program.body[0] as any).expression.arguments[2]
    expect(thirdArg.type).toBe('CallExpression')
    expect(thirdArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.runtime.getURL', () => {
    const code = `chrome.runtime.getURL('popup.html');`
    const ast = parse(code)
    transformSource(ast, code)
    // Check if the first argument of the first expression is a call to resolveString
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.tabs.create', () => {
    const code = `chrome.tabs.create({ url: 'https://google.com' });`
    const ast = parse(code)
    transformSource(ast, code)
    // Check if the first argument of the first expression is a call to resolveUrl
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })

  test('should transform chrome.sidePanel.setOptions', () => {
    const code = `chrome.sidePanel.setOptions({ title: 'My Panel' });`
    const ast = parse(code)
    transformSource(ast, code)
    // Check if the first argument of the first expression is a call to resolvePath
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.solve')
  })
})
