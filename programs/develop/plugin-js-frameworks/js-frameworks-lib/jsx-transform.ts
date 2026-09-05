//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {isUsingPreact} from '../js-tools/preact'
import {isUsingReact} from '../js-tools/react'
import {isUsingSolid} from '../js-tools/solid'
import {isUsingVue} from '../js-tools/vue'

export type JsxImportSource = 'react' | 'preact' | 'solid-js' | 'vue'

export function isUsingJsxFramework(projectPath: string): boolean {
  return (
    isUsingReact(projectPath) ||
    isUsingPreact(projectPath) ||
    isUsingSolid(projectPath) ||
    isUsingVue(projectPath)
  )
}

// The automatic JSX runtime is imported from the renderer the project
// installed. React comes last: Preact and Vue projects often carry React
// types without wanting react/jsx-runtime in the bundle.
export function getJsxImportSource(projectPath: string): JsxImportSource {
  if (isUsingSolid(projectPath)) return 'solid-js'
  if (isUsingPreact(projectPath) && !isUsingReact(projectPath)) return 'preact'
  if (
    isUsingVue(projectPath) &&
    !isUsingReact(projectPath) &&
    !isUsingPreact(projectPath)
  ) {
    return 'vue'
  }
  return 'react'
}

export interface SwcParserOptions {
  syntax: 'typescript' | 'ecmascript'
  tsx?: boolean
  jsx?: boolean
  dynamicImport: boolean
}

// The file extension decides the parser: a .ts file never holds JSX and a
// .jsx file always may, whatever tsconfig or framework the project has.
export function swcParserForFile(
  resourcePath: string,
  jsxInPlainJs: boolean
): SwcParserOptions {
  const clean = String(resourcePath || '').split('?')[0]
  const ext = path.extname(clean).toLowerCase()
  if (ext === '.tsx' || ext === '.mtsx') {
    return {syntax: 'typescript', tsx: true, dynamicImport: true}
  }
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
    return {syntax: 'typescript', tsx: false, dynamicImport: true}
  }
  if (ext === '.jsx' || ext === '.mjsx') {
    return {syntax: 'ecmascript', jsx: true, dynamicImport: true}
  }
  return {syntax: 'ecmascript', jsx: jsxInPlainJs, dynamicImport: true}
}
