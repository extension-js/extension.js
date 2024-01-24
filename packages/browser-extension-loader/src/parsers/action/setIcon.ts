import * as parser from '@babel/parser'
import traverse from '@babel/traverse'

interface ParseResult {
  path: string
}

export default function parseChromeActionSetIcon(
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

      // Check if the callee is `chrome.action.setIcon`
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'MemberExpression' &&
        callee.object.object.type === 'Identifier' &&
        callee.object.object.name === 'chrome' &&
        callee.object.property.type === 'Identifier' &&
        callee.object.property.name === 'action' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'setIcon'
      ) {
        const args = path.node.arguments
        if (args.length > 0 && args[0].type === 'ObjectExpression') {
          const pathProperty = args[0].properties.find(
            (property: any) =>
              property.type === 'ObjectProperty' &&
              property.key.type === 'Identifier' &&
              property.key.name === 'path'
          )

          // Handle different types of path values (string, object, or object with specific sizes)
          if (pathProperty) {
            if (pathProperty.value.type === 'StringLiteral') {
              results.push({path: pathProperty.value.value})
            } else if (pathProperty.value.type === 'ObjectExpression') {
              pathProperty.value.properties.forEach((prop: any) => {
                if (prop.value.type === 'StringLiteral') {
                  results.push({path: prop.value.value})
                }
              })
            }
          }
        }
      }
    }
  })

  return results
}
