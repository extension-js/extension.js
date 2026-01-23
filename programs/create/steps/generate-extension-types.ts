//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs/promises'
import * as messages from '../lib/messages'

export async function generateExtensionTypes(
  projectPath: string,
  projectName: string
) {
  const extensionEnvFile = path.join(projectPath, 'extension-env.d.ts')
  const {
    dependencies,
    devDependencies,
    peerDependencies,
    optionalDependencies
  } = await readPackageJson(projectPath)
  const hasDependency = (name: string) =>
    Boolean(
      dependencies[name] ||
      devDependencies[name] ||
      peerDependencies[name] ||
      optionalDependencies[name]
    )
  const usesReact = hasDependency('react') || hasDependency('@types/react')
  const usesReactDom =
    hasDependency('react-dom') || hasDependency('@types/react-dom')
  const usesSvelte = hasDependency('svelte')
  const frameworkTypeRefs = [
    usesReact ? '/// <reference types="react" />' : '',
    usesReactDom ? '/// <reference types="react-dom" />' : '',
    usesSvelte ? '/// <reference types="svelte" />' : ''
  ]
    .filter(Boolean)
    .join('\n')
  const fileContent = `\
// Required Extension.js types for TypeScript projects.
// This file is auto-generated and should not be excluded.
//
/// <reference types="webextension-polyfill" />
/// <reference types="node" />
/// <reference types="chrome" />
${frameworkTypeRefs}

declare global {
  const browser: typeof import('webextension-polyfill')

  type ExtensionBrowser =
    | 'chrome'
    | 'edge'
    | 'firefox'
    | 'chromium-based'
    | 'gecko-based'

  type ExtensionMode = 'development' | 'production'

  interface ExtensionEnv {
    EXTENSION_BROWSER: ExtensionBrowser
    EXTENSION_MODE: ExtensionMode
    EXTENSION_PUBLIC_BROWSER: ExtensionBrowser
    EXTENSION_PUBLIC_MODE: ExtensionMode
    EXTENSION_PUBLIC_DESCRIPTION_TEXT: string
    EXTENSION_PUBLIC_LLM_API_KEY: string
    EXTENSION_AUTHOR_MODE: string
    EXTENSION_PUBLIC_AUTHOR_MODE: string
  }

  namespace NodeJS {
    interface ProcessEnv extends ExtensionEnv {
      [key: string]: string | undefined
    }
  }

  interface ImportMetaEnv extends ExtensionEnv {
    [key: string]: string | undefined
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
    readonly webpackHot?: {
      accept: (module?: string | string[], callback?: () => void) => void
      dispose: (callback: () => void) => void
    }
    url: string
  }

  interface Window {
    /**
     * @deprecated
     * @description
     * This is how Extension.js used to inject the shadow root into the window object.
     * Use the shadowRoot reference from the content script instead.
     */
    __EXTENSION_SHADOW_ROOT__: ShadowRoot
  }
}

type CSSContentData = Readonly<Record<string, string>>
type CSSModuleData = Readonly<Record<string, string>>

declare module '*.css' {
  const content: CSSContentData
  export default content
}

declare module '*.module.css' {
  const content: CSSModuleData
  export default content
}
declare module '*.module.scss' {
  const content: CSSModuleData
  export default content
}
declare module '*.module.sass' {
  const content: CSSModuleData
  export default content
}

declare module '*.png' {
  const content: string
  export default content
}
declare module '*.jpg' {
  const content: string
  export default content
}
declare module '*.jpeg' {
  const content: string
  export default content
}
declare module '*.gif' {
  const content: string
  export default content
}
declare module '*.webp' {
  const content: string
  export default content
}
declare module '*.avif' {
  const content: string
  export default content
}
declare module '*.ico' {
  const content: string
  export default content
}
declare module '*.bmp' {
  const content: string
  export default content
}
declare module '*.svg' {
  const content: any
  export default content
}

export {}
`

  try {
    await fs.mkdir(projectPath, {recursive: true})

    console.log(messages.writingTypeDefinitions(projectName))

    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (error: any) {
    console.error(messages.writingTypeDefinitionsError(error))
    throw error
  }
}

async function readPackageJson(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')
  try {
    const content = await fs.readFile(packageJsonPath, 'utf8')
    const parsed = JSON.parse(content) || {}
    return {
      dependencies: parsed.dependencies || {},
      devDependencies: parsed.devDependencies || {},
      peerDependencies: parsed.peerDependencies || {},
      optionalDependencies: parsed.optionalDependencies || {}
    }
  } catch {
    return {
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
      optionalDependencies: {}
    }
  }
}
