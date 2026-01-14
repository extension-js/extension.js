// ███████╗ █████╗ ███╗   ██╗██╗████████╗██╗███████╗███████╗
// ██╔════╝██╔══██╗████╗  ██║██║╚══██╔══╝██║╚══███╔╝██╔════╝
// ███████╗███████║██╔██╗ ██║██║   ██║   ██║  ███╔╝ █████╗
// ╚════██║██╔══██║██║╚██╗██║██║   ██║   ██║ ███╔╝  ██╔══╝
// ███████║██║  ██║██║ ╚████║██║   ██║   ██║███████╗███████╗
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝   ╚═╝   ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

export function sanitize<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj || {}).filter(
      ([, value]) => typeof value !== 'undefined'
    )
  ) as Partial<T>
}
