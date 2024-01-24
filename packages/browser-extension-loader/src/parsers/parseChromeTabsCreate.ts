import * as parser from '@babel/parser'
import traverse from '@babel/traverse'

interface ParseResult {
  path: string
}

export default function parseChromeTabsCreate(source: string): ParseResult[] {
  const ast = parser.parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  })

  const results: ParseResult[] = []

  traverse(ast as any, {
    CallExpression(path: any) {
      const callee = path.node.callee

      // Check if the callee is `chrome.tabs.create`
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'MemberExpression' &&
        callee.object.object.type === 'Identifier' &&
        callee.object.object.name === 'chrome' &&
        callee.object.property.type === 'Identifier' &&
        callee.object.property.name === 'tabs' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'create'
      ) {
        const args = path.node.arguments
        if (args.length > 0 && args[0].type === 'ObjectExpression') {
          const urlProperty = args[0].properties.find(
            (property: any) =>
              property.type === 'ObjectProperty' &&
              property.key.type === 'Identifier' &&
              property.key.name === 'url' &&
              property.value.type === 'StringLiteral'
          )
          if (
            urlProperty &&
            urlProperty.type === 'ObjectProperty' &&
            urlProperty.value.type === 'StringLiteral'
          ) {
            const urlValue = urlProperty.value.value
            results.push({path: urlValue})
          }
        }
      }
    }
  })

  return results
}
