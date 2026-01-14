//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

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
  /**
   * Use `any` to avoid conflicts with
   * `@svgr/webpack` plugin or
   * `babel-plugin-inline-react-svg` plugin.
   */
  const content: any

  export default content
}
