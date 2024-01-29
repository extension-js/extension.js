import * as parser from '@babel/parser'
import traverse from '@babel/traverse'
import fs from 'fs'

export default function parseScript(
  filePath: string,
  namespace: string
): boolean {
  // Read the file content
  const fileContent = fs.readFileSync(filePath, 'utf-8')

  // Initialize found flag
  let found = false

  try {
    // Parse the file content into an AST
    const ast = parser.parse(fileContent, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    })

    // Split the namespace into components
    const namespaceComponents = namespace.split('.')

    // Traverse the AST to find occurrences of the specified API
    traverse(ast, {
      MemberExpression(path) {
        let current: any = path.node
        for (let i = namespaceComponents.length - 1; i >= 0; i--) {
          if (
            !current.property ||
            current.property.name !== namespaceComponents[i]
          ) {
            return
          }
          current = current.object
        }
        if (current.name === namespaceComponents[0]) {
          found = true
          // Stop traversal once found
          path.stop()
        }
      }
    })
  } catch (error) {
    // Continue execution the error
    console.log(`Error parsing file: ${filePath}`)
    console.error(error)
  }

  return found
}
