// The memory tab: a right-sidebar tab that shows the team's Bots as their own
// characters. A native Session dragged from the left sidebar onto a Bot is read into
// that Bot's memory — the Session itself stays where it was, this only reads it — and
// the Bot's model suggests who it became. The suggestion waits for the user: a name
// they wrote themselves is never overwritten without them adopting it.
//
// Every learned Session is remembered per Bot, so the panel can send the user back to
// the original conversation, and learn more from it later.
//
// This is the native surface's seat for the team, not the Bot surface's own memory
// dialog (that one is memory-panel.js and lives inside DS Bot's shell).
import { createElement as h, useEffect, useState } from 'react'
import { call } from './api.js'
import { language } from './i18n.js'
import { characterMarkup, MASK_ID, shapeOf } from './characters.js'
import { INKS } from './inks.js'
import { DsBotNavIcon } from './sidebar.js'

export const MEMORY_TAB_ID = 'ds-bot-memory'

const zh = () => language().startsWith('zh')
const say = (zhText, enText) => (zh() ? zhText : enText)

export const MEMORY_TAB_CSS = `
.bt-mem{display:flex;flex-direction:column;gap:12px;padding:14px 12px;height:100%;overflow:auto;font-family:var(--dsw-font-family,inherit);color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.5;box-sizing:border-box}
.bt-mem-head{display:flex;flex-direction:column;gap:4px}
.bt-mem-title{font-size:14px;font-weight:600}
.bt-mem-hint{font-size:12px;opacity:.62}
.bt-mem-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.bt-mem-card{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 8px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.24));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));cursor:default;transition:background-color .12s ease,border-color .12s ease,transform .12s ease;text-align:center}
.bt-mem-card[data-over]{border-color:var(--dsw-alias-state-business-primary,#4D6BFE);background:var(--dsw-alias-bg-layer-2,rgba(77,107,254,.12));transform:scale(1.02)}
.bt-mem-card[data-busy]{opacity:.6}
.bt-mem-card svg{flex:none;line-height:0}
.bt-mem-name{font-size:12px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-mem-role{font-size:11px;opacity:.6;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-mem-note{font-size:12px;opacity:.7;overflow-wrap:anywhere}
.bt-mem-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#d33);overflow-wrap:anywhere}
.bt-mem-suggest{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.24));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}
.bt-mem-suggest-name{font-weight:600}
.bt-mem-suggest-duty{opacity:.8}
.bt-mem-actions{display:flex;gap:8px}
.bt-mem-btn{min-height:26px;padding:0 12px;border:0;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18));color:inherit;font:inherit;font-size:12px;cursor:pointer}
.bt-mem-btn:hover{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.28))}
.bt-mem-btn[data-primary]{background:var(--dsw-alias-state-business-primary,#4D6BFE);color:#fff}
.bt-mem-empty{font-size:12px;opacity:.6}
.bt-mem-sources{display:flex;flex-direction:column;gap:6px}
.bt-mem-source{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}
.bt-mem-source-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bt-mem-source-title{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-mem-source-bot{font-size:11px;opacity:.55}
.bt-mem-link{min-height:24px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.bt-mem-link:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18));color:inherit}
`

let avatarSerial = 0

// A Bot's own character, painted with a concrete ink: the panel lives outside the Bot
// surface, where DS Bot's ink variables are not defined.
function BotAvatar({ look, size = 40 }) {
  const box = shapeOf(look.shape).size
  const mask = `bt-mem-${++avatarSerial}`
  const dark = document.documentElement.hasAttribute('data-ds-dark-theme')
  const ink = INKS[look.color]?.[dark ? 1 : 0] ?? '#4D6BFE'
  return h('svg', {
    width: size,
    height: size,
    viewBox: `0 0 ${box} ${box}`,
    'aria-hidden': true,
    focusable: 'false',
    dangerouslySetInnerHTML: { __html: characterMarkup(look.shape, ink).replaceAll(MASK_ID, mask) },
  })
}

const lookOfBot = (bot) => ({ shape: bot?.avatar?.shape ?? 'whale', color: bot?.color ?? 'deepseek' })

export function MemoryTabTitle() {
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
    h(DsBotNavIcon, { size: 14 }),
    h('span', null, say('DS Bot 记忆', 'DS Bot memory')))
}

export function MemoryTabBody(props) {
  // The tab body is registered with `inject: face`, which supplies the team hooks. If a
  // host ever hands it a body without them, say so instead of throwing: a blank panel
  // tells nobody why it is blank.
  const useRoster = typeof props?.useRoster === 'function' ? props.useRoster : null
  const roster = useRoster === null ? null : useRoster(value => value)
  const [busy, setBusy] = useState(null)
  const [over, setOver] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [sources, setSources] = useState({})
  const bots = roster?.bots ?? []

  const refreshSources = async () => {
    try { setSources(await call('learned-sources') ?? {}) } catch { /* the panel still works */ }
  }
  useEffect(() => { void refreshSources() }, [])

  const learn = async (botId, sessionId) => {
    setBusy(botId)
    setError('')
    setResult(null)
    try {
      const value = await call('learn-session', { botId, sessionId })
      const bot = bots.find(entry => entry.id === botId)
      setResult({
        botId,
        botName: bot?.name ?? '',
        title: value?.title ?? '',
        suggestion: value?.suggestion ?? null,
      })
      void refreshSources()
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    } finally {
      setBusy(null)
    }
  }

  const onDrop = (event, botId) => {
    event.preventDefault()
    setOver(null)
    const sessionId = event.dataTransfer?.getData('text/plain') ?? ''
    if (sessionId === '') return
    void learn(botId, sessionId)
  }

  const adopt = async () => {
    const suggestion = result?.suggestion
    if (suggestion === null || suggestion === undefined) return
    try {
      await call('update-bot', {
        id: result.botId,
        ...(suggestion.name ? { name: suggestion.name } : {}),
        ...(suggestion.duty ? { role: suggestion.duty } : {}),
      })
      setResult(null)
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    }
  }

  const nameOf = (botId) => bots.find(bot => bot.id === botId)?.name ?? botId
  const rows = Object.entries(sources)
    .flatMap(([botId, list]) => (Array.isArray(list) ? list : []).map(row => ({ botId, ...row })))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))

  const cards = useRoster === null
    ? null
    : bots.length === 0
    ? h('div', { className: 'bt-mem-empty' }, say('团队还没有 Bot。', 'The team has no Bots yet.'))
    : h('div', { className: 'bt-mem-grid' }, bots.map(bot => h('div', {
      key: bot.id,
      className: 'bt-mem-card',
      'data-over': over === bot.id ? '' : undefined,
      'data-busy': busy === bot.id ? '' : undefined,
      onDragOver: (event) => {
        event.preventDefault()
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
        if (over !== bot.id) setOver(bot.id)
      },
      onDragLeave: () => { if (over === bot.id) setOver(null) },
      onDrop: (event) => onDrop(event, bot.id),
    },
    h(BotAvatar, { look: lookOfBot(bot), size: 40 }),
    h('div', { className: 'bt-mem-name' }, bot.name),
    bot.role ? h('div', { className: 'bt-mem-role' }, bot.role) : null)))

  const suggestion = result !== null && result.suggestion !== null
    ? h('div', { className: 'bt-mem-suggest' },
      h('div', { className: 'bt-mem-note' }, say(`${result.botName} 学完了，它觉得自己变成了：`, `${result.botName} learned it. It thinks it became:`)),
      h('div', { className: 'bt-mem-suggest-name' }, result.suggestion.name || say('（名字不变）', '(name unchanged)')),
      h('div', { className: 'bt-mem-suggest-duty' }, result.suggestion.duty || ''),
      h('div', { className: 'bt-mem-note' }, say('采纳才会改写它的名字和职责。', 'Adopting rewrites its name and role.')),
      h('div', { className: 'bt-mem-actions' },
        h('button', { type: 'button', className: 'bt-mem-btn', 'data-primary': '', onClick: () => { void adopt() } }, say('采纳', 'Adopt')),
        h('button', { type: 'button', className: 'bt-mem-btn', onClick: () => setResult(null) }, say('忽略', 'Dismiss'))))
    : result !== null
      ? h('div', { className: 'bt-mem-note' }, say(`${result.botName} 学完了，但没给出人设建议。`, `${result.botName} learned it, but offered no persona suggestion.`))
      : null

  const learned = rows.length === 0
    ? null
    : h('div', { className: 'bt-mem-sources' },
      h('div', { className: 'bt-mem-title' }, say('学过的会话', 'Sessions learned')),
      rows.map(row => h('div', { key: `${row.botId}:${row.sessionId}`, className: 'bt-mem-source' },
        h('div', { className: 'bt-mem-source-text' },
          h('div', { className: 'bt-mem-source-title', title: row.title || row.sessionId }, row.title || row.sessionId),
          h('div', { className: 'bt-mem-source-bot' }, nameOf(row.botId))),
        h('button', {
          type: 'button',
          className: 'bt-mem-link',
          title: say('回到这条会话', 'Open the original session'),
          onClick: () => { try { props.actions.show(row.sessionId) } catch { /* the session may be gone */ } },
        }, say('跳转', 'Open')),
        h('button', {
          type: 'button',
          className: 'bt-mem-link',
          title: say('再读一遍，学新的内容', 'Read it again for anything new'),
          disabled: busy !== null,
          onClick: () => { void learn(row.botId, row.sessionId) },
        }, say('再学', 'Relearn')))))

  return h('div', { className: 'bt-mem' },
    h('div', { className: 'bt-mem-head' },
      h('div', { className: 'bt-mem-title' }, say('DS Bot 记忆', 'DS Bot memory')),
      h('div', { className: 'bt-mem-hint' }, say('把左侧的会话拖到某个 Bot 上，它会读完并记住；会话本身留在原处。', 'Drag a session from the left onto a Bot: it reads it into memory and the session stays where it was.'))),
    useRoster === null
      ? h('div', { className: 'bt-mem-error' }, say('面板没拿到团队数据（hooks 未注入）。把这句话告诉我，我去改注册方式。', 'The panel got no team data (hooks not injected). Tell me this line and I will fix the registration.'))
      : null,
    cards,
    busy !== null ? h('div', { className: 'bt-mem-note' }, say('正在读这个会话…', 'Reading the session…')) : null,
    error !== '' ? h('div', { className: 'bt-mem-error' }, error) : null,
    suggestion,
    learned)
}
