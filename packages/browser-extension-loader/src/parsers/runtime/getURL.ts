import * as parser from '@babel/parser'
import traverse from '@babel/traverse'

interface ParseResult {
  path: string
}

export default function parseChromeRuntimeGetURL(
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

      // Check if the callee is `chrome.runtime.getURL`
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'MemberExpression' &&
        callee.object.object.type === 'Identifier' &&
        callee.object.object.name === 'chrome' &&
        callee.object.property.type === 'Identifier' &&
        callee.object.property.name === 'runtime' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'getURL'
      ) {
        const args = path.node.arguments
        if (args.length > 0) {
          // Handle both string literals and template literals
          if (args[0].type === 'StringLiteral') {
            results.push({path: args[0].value})
          } else if (args[0].type === 'TemplateLiteral') {
            const quasis = args[0].quasis
              .map((elem: any) => elem.value.cooked)
              .join('')

            results.push({path: quasis})
          }
        }
      }
    }
  })

  return results
}
