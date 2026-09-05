// Wildcard module declarations for assets and stylesheets.
// This file is a script on purpose: index.d.ts is a module (it augments the
// global scope), and a wildcard `declare module` inside a module file is an
// augmentation TypeScript silently ignores, so the declares live here and
// index.d.ts pulls them in through a reference.

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
  // Use any to avoid conflicts with SVGR or other SVG loaders.
  // biome-ignore lint/suspicious/noExplicitAny: deliberate, a stricter type conflicts with SVGR-style loaders
  const content: any
  export default content
}
