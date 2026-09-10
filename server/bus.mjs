import { EventEmitter } from 'node:events'
import { publishBus, redisEnabled, subscribeBus } from './redis.mjs'

const local = new EventEmitter()
local.setMaxListeners(200)

export const bus = {
  on: (...args) => local.on(...args),
  off: (...args) => local.off(...args),
  emit(type, payload) {
    const result = local.emit(type, payload)
    if (redisEnabled()) void publishBus(type, payload)
    return result
  },
}

export async function attachBus() {
  if (!redisEnabled()) return
  await subscribeBus((type, payload) => {
    local.emit(type, payload)
  })
}
