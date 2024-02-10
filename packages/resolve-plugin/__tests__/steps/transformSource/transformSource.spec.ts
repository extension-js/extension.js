import transformSource from '../../../steps/transformSource'
import {parse} from '@babel/parser'

describe('transformSource Tests', () => {
  const resolverName = 'resolver-module.js'

  test('should transform chrome.action.setIcon', () => {
    const code = `chrome.action.setIcon({ path: 'icon.png' });`
    const ast = parse(code)
    transformSource(ast, code, resolverName)
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.resolvePath')
  })

  test('should transform chrome.action.setPopup', () => {
    const code = `chrome.action.setPopup({ popup: 'popup.html' });`
    const ast = parse(code)
    transformSource(ast, code, resolverName)
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.resolvePopup')
  })

  // devtools
  test('should transform chrome.devtools.panels.create', () => {
    const code = `chrome.devtools.panels.create('My Panel', 'icon.png', 'panel.html');`
    const ast = parse(code)
    transformSource(ast, code, resolverName)
    const secondArg = (ast.program.body[0] as any).expression.arguments[1]
    expect(secondArg.type).toBe('CallExpression')
    expect(secondArg.callee.name).toBe('r.resolveString')
    const thirdArg = (ast.program.body[0] as any).expression.arguments[2]
    expect(thirdArg.type).toBe('CallExpression')
    expect(thirdArg.callee.name).toBe('r.resolveString')
  })

  test('should transform chrome.runtime.getURL', () => {
    const code = `chrome.runtime.getURL('popup.html');`
    const ast = parse(code)
    transformSource(ast, code, resolverName)
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.resolveString')
  })

  test('should transform chrome.tabs.create', () => {
    const code = `chrome.tabs.create({ url: 'https://google.com' });`
    const ast = parse(code)
    transformSource(ast, code, resolverName)
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.resolveUrl')
  })

  test('should transform chrome.scripting.insertCSS', () => {
    const code = `chrome.scripting.insertCSS({ files: [myfile.css] });`
    const ast = parse(code)
    transformSource(ast, code, resolverName)
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.resolveFiles')
  })

  test('should transform chrome.scripting.registerContentScripts', () => {
    const code = `chrome.scripting.registerContentScripts({ js: [myjs.js] });`
    const ast = parse(code)
    transformSource(ast, code, resolverName)
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.resolveJs')
  })

  test('should transform chrome.declarativeContent.RequestContentScript', () => {
    const code = `chrome.declarativeContent.RequestContentScript({ css: [mycss.css] });`
    const ast = parse(code)
    transformSource(ast, code, resolverName)
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.resolveCss')
  })

  test('should transform chrome.sidePanel.setOptions', () => {
    const code = `chrome.sidePanel.setOptions({ title: 'My Panel' });`
    const ast = parse(code)
    transformSource(ast, code, resolverName)
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.resolvePath')
  })

  test('should transform chrome.notifications.create', () => {
    const code = `chrome.notifications.create({ iconUrl: 'myicon.png' });`
    const ast = parse(code)
    transformSource(ast, code, resolverName)
    const firstArg = (ast.program.body[0] as any).expression.arguments[0]
    expect(firstArg.type).toBe('CallExpression')
    expect(firstArg.callee.name).toBe('r.resolveIconUrl')
  })
})
