// Which Sessions a Bot learned from. Kept beside the memory, newest first: the panel
// lists them so the user can go back to the original conversation, and a Bot may read
// one again when it does not remember something.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LIMIT = 40

const pathOf = (rt) => join(rt.home, 'memory', 'learned.json')

export function readLearned(rt) {
  try {
    const value = JSON.parse(readFileSync(pathOf(rt), 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

export function learnedOf(rt, botId) {
  const rows = readLearned(rt)[botId]
  return Array.isArray(rows) ? rows : []
}

export function noteLearned(rt, botId, sessionId, title) {
  const all = readLearned(rt)
  const rows = (Array.isArray(all[botId]) ? all[botId] : []).filter(row => row?.sessionId !== sessionId)
  rows.unshift({ sessionId, title: String(title ?? ''), at: Date.now() })
  all[botId] = rows.slice(0, LIMIT)
  try {
    mkdirSync(join(rt.home, 'memory'), { recursive: true })
    writeFileSync(pathOf(rt), JSON.stringify(all, null, 2))
  } catch (error) {
    rt.warn('ds-bot: learned sources could not be saved: %s', error?.message ?? error)
  }
}
