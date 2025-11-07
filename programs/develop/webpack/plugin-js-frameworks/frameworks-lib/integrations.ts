export {
  installOptionalDependencies,
  hasDependency
} from '../../plugin-css/css-lib/integrations'
export function isUsingJSFramework(projectPath: string): boolean {
  const frameworks = [
    'react',
    'vue',
    '@angular/core',
    'svelte',
    'solid-js',
    'preact'
  ]
  return frameworks.some((fw) =>
    require('../../plugin-css/css-lib/integrations').hasDependency(
      projectPath,
      fw
    )
  )
}
