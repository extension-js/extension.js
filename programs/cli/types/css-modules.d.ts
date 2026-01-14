//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

type CSSModuleData = Readonly<Record<string, string>>

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
