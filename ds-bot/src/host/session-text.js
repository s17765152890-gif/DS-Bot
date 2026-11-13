// Reading a Session that is not the Bot's own chat: the memory panel learns from one,
// and a Bot may go back to one it learned from. Both read the same way — who spoke, one
// line per message, tail kept when the conversation is long, because the end of a talk
// is what a later question is usually about.
const READ_MS = 20_000
const TEXT_MAX = 14_000

export async function readSessionText(rt, sessionId, { max = TEXT_MAX } = {}) {
  const lines = []
  for await (const line of rt.partLines(sessionId, AbortSignal.timeout(READ_MS), { pages: Infinity })) {
    const who = line.who === 'user' ? 'User' : line.who === 'you' ? 'Bot' : String(line.who ?? 'Other')
    const text = String(line.text ?? '').trim()
    if (text !== '') lines.push(`${who}: ${text}`)
  }
  const joined = lines.join('\n')
  return joined.length > max ? joined.slice(-max) : joined
}
