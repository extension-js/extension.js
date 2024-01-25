export interface Callee {
  type: string
  object: {
    type: string
    object?: {
      type: string
      name: string
    }
    property?: {
      type: string
      name: string
    }
  }
  property?: {
    type: string
    name: string
  }
}
