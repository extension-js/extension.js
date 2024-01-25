import template from '@babel/template'
import path from 'path'

export default function addImportDeclaration(
  ast: any,
  resolverModulePath: string,
  self?: any
) {
  const outputPath = self?._compilation?.options.output.path || ''
  const resolverAbsolutePath = path.join(outputPath, resolverModulePath)

  console.log({resolverAbsolutePath})
  const importString = `import r from '${resolverAbsolutePath}';`
  const existingImport = ast.program.body.find(
    (node: any) =>
      node.type === 'ImportDeclaration' &&
      node.source.value === resolverAbsolutePath
  )

  if (!existingImport) {
    const importDeclaration = template.ast(importString, {
      preserveComments: true
    })
    ast.program.body.unshift(importDeclaration)
  }
}
