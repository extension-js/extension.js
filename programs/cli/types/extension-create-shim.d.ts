//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

declare module 'extension-create' {
  // These types mirror the public surface of programs/create/module.ts,
  // but are intentionally loose on the CLI side. The real, precise types
  // come from the installed `extension-create` package when consumers
  // depend on it directly.

  export interface CreateOptions {
    template: string
    install?: boolean
    cliVersion?: string
  }

  export function extensionCreate(
    projectNameInput: string | undefined,
    options: CreateOptions
  ): Promise<void>
}
