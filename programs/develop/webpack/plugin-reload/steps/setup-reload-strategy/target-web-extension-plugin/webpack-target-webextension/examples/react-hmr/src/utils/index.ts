export function isMessage(message: unknown): message is Message {
  return (
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'message' &&
    'content' in message &&
    typeof message.content === 'string'
  )
}
export type Message = { type: 'message'; content: string }

export function isGetAll(message: unknown): message is GetAll {
  return typeof message === 'object' && 'type' in message && message.type === 'get_all'
}
export type GetAll = { type: 'get_all' }

export function isGetAllResponse(message: unknown): message is GetAllResponse {
  return (
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'get_all_resp' &&
    'messages' in message &&
    Array.isArray(message.messages) &&
    message.messages.every((item) => typeof item === 'string')
  )
}
export type GetAllResponse = { type: 'get_all_resp'; messages: readonly string[] }

export function isClear(message: unknown): message is Clear {
  return typeof message === 'object' && 'type' in message && message.type === 'clear'
}
export type Clear = { type: 'clear' }
