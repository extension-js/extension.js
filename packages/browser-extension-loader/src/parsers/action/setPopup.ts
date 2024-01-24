import * as parser from '@babel/parser'
import traverse from '@babel/traverse'

interface ParseResult {
  path: string
}

export default function parseChromeActionSetPopup(
  source: string
): ParseResult[] {
  const ast = parser.parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  })

  const results: ParseResult[] = []

  traverse(ast as any, {
    CallExpression(path: any) {
      const callee = path.node.callee

      // Check if the callee is `chrome.action.setPopup`
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'MemberExpression' &&
        callee.object.object.type === 'Identifier' &&
        callee.object.object.name === 'chrome' &&
        callee.object.property.type === 'Identifier' &&
        callee.object.property.name === 'action' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'setPopup'
      ) {
        const args = path.node.arguments
        if (args.length > 0 && args[0].type === 'StringLiteral') {
          const popupPath = args[0].value
          results.push({path: popupPath})
        }
      }
    }
  })

  return results
}
