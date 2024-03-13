type CSSContentData = Readonly<Record<string, string>>

declare module '*.css' {
  const content: CSSContentData

  export default content
}
