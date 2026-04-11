import { useState, useEffect, useCallback, useRef } from 'react'

type Tab = 'overview' | 'messages' | 'media' | 'apps' | 'logs' | 'mcp'

const API = '/dashboard/api'
const AUTH = '/dashboard/auth'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Chat { id: string; name: string; isGroup: boolean; lastMessageAt: string; unreadCount: number }
interface Reaction { messageId: string; senderId: string; senderName: string; emoji: string; timestamp: string }
interface Message { id: string; chatId: string; senderName: string; content: string; type: string; mimeType?: string; timestamp: string; isFromMe: boolean; isGroup: boolean; groupName?: string; editedAt?: string; deletedAt?: string; reactions?: Reaction[] }
interface MessageEdit { oldContent: string; editedAt: string }
interface AppRecord { id: string; name: string; description: string; webhookGlobalUrl: string; webhookSecret: string; webhookEvents: { name: string; url?: string }[]; apiKey: string; permissions: string[]; scopeChatTypes: string[]; scopeSpecificChats: string[]; active: boolean; createdAt: string }
interface Delivery { id: string; app_id: string; event: string; payload: string; status: string; attempts: number; last_attempt_at: number; response_status: number; created_at: number }
interface Stats { messages: number; chats: number; media: number; apps: number; deliveries: number }

// ─── Theme ───────────────────────────────────────────────────────────────────

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches))
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('theme', dark ? 'dark' : 'light') }, [dark])
  return { dark, toggle: () => setDark(d => !d) }
}

// ─── Centralized fetch with 401 → logout ────────────────────────────────────

let onSessionExpired: (() => void) | null = null

/** Wrapper around fetch that redirects to login on 401 */
async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  const res = await fetch(url, { credentials: 'include', ...opts })
  if (res.status === 401) { onSessionExpired?.(); throw new Error('session expired') }
  return res
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchKey, setFetchKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    const c = new AbortController()
    apiFetch(url, { signal: c.signal })
      .then(r => r.ok ? r.json() : null)
      .then((d: T | null) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false) } })
    return () => { cancelled = true; c.abort() }
  }, [url, fetchKey])
  const refetch = useCallback(() => setFetchKey(k => k + 1), [])
  return { data, loading, refetch }
}

// ─── Text helpers ───────────────────────────────────────────────────────────

const URL_RE = /(https?:\/\/[^\s<]+)/g

function formatTimeRemaining(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `in ${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `in ${days}d`
}

function Linkify({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE)
  return <span className={className}>{parts.map((p, i) => URL_RE.test(p)
    ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">{p}</a>
    : p
  )}</span>
}

function useMessageStyles(isFromMe: boolean) {
  return {
    dimClass: isFromMe ? 'text-white/60' : 'text-[var(--text-tertiary)]',
    btnClass: `font-bold cursor-pointer select-none ${isFromMe ? 'text-white/70 hover:text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`,
    linkClass: `underline underline-offset-2 cursor-pointer ${isFromMe ? 'text-white/70 hover:text-white' : 'hover:text-[var(--text-secondary)]'}`,
  }
}

function EditHistory({ messageId, isFromMe, currentContent, timestamp, suffix, activeSuffix }: { messageId: string; isFromMe: boolean; currentContent: string; timestamp: string; suffix?: React.ReactNode; activeSuffix?: React.ReactNode }) {
  const [edits, setEdits] = useState<MessageEdit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [versionIndex, setVersionIndex] = useState(-1) // -1 = closed/current
  const [direction, setDirection] = useState<'left' | 'right'>('right')

  const open = async () => {
    if (!edits) {
      setLoading(true)
      try {
        const r = await apiFetch(`${API}/messages/${messageId}/edits`)
        if (r.ok) {
          const data = await r.json() as MessageEdit[]
          setEdits(data)
          if (data.length > 0) { setDirection('left'); setVersionIndex(0) }
        }
      } catch { /* handled by apiFetch */ }
      setLoading(false)
    } else {
      setDirection('left'); setVersionIndex(0)
    }
  }

  const close = () => setVersionIndex(-1)

  const versions = edits ? [...edits.toReversed(), { oldContent: currentContent, editedAt: timestamp }] : []
  const totalVersions = versions.length
  const isActive = versionIndex >= 0 && versions.length > 0
  const isCurrentVersion = versionIndex === totalVersions - 1
  const displayContent = isActive ? versions[versionIndex]?.oldContent ?? currentContent : currentContent

  const prev = () => { setDirection('left'); setVersionIndex((versionIndex - 1 + totalVersions) % totalVersions) }
  const next = () => { setDirection('right'); setVersionIndex((versionIndex + 1) % totalVersions) }

  const { dimClass, btnClass, linkClass } = useMessageStyles(isFromMe)
  const slideClass = direction === 'left' ? 'animate-slide-left' : 'animate-slide-right'

  return (
    <>
      <div key={versionIndex} className={`text-sm font-medium break-words ${isActive ? slideClass : ''}`}>{displayContent ? <Linkify text={displayContent} /> : '[empty]'}</div>
      {isActive ? (
        <div className={`animate-in-fast flex items-center gap-2 mt-2 text-xs font-medium ${dimClass}`}>
          <button onClick={prev} className={btnClass}>←</button>
          <span>{isCurrentVersion ? 'Current' : `Version ${versionIndex + 1} of ${totalVersions} · ${new Date(versions[versionIndex].editedAt).toLocaleString()}`}</span>
          <button onClick={next} className={btnClass}>→</button>
          <button onClick={close} className={`${btnClass} ml-1`}>✕</button>
          {activeSuffix ?? suffix}
        </div>
      ) : (
        <div className={`text-xs mt-2 font-medium ${dimClass}`}>
          {new Date(timestamp).toLocaleTimeString()}
          {loading ? <span className="ml-1 animate-fade">loading...</span> : (
            <><span className="mx-1">·</span><button onClick={open} className={linkClass}>(edited)</button></>
          )}
          {suffix}
        </div>
      )}
    </>
  )
}

function DeletedMessage({ message: m, isFromMe }: { message: Message; isFromMe: boolean }) {
  const [revealed, setRevealed] = useState(false)
  const { dimClass, linkClass } = useMessageStyles(isFromMe)

  if (!revealed) {
    return (
      <div className={`text-xs font-medium ${dimClass}`}>
        <span>🚫 This message was deleted</span>
        <span className="mx-1">·</span>
        <button onClick={() => setRevealed(true)} className={linkClass}>(reveal)</button>
      </div>
    )
  }

  const hideBtn = <button onClick={() => setRevealed(false)} className={linkClass}>(hide)</button>
  const hideSuffixWithDot = <><span className="mx-1">·</span>{hideBtn}</>
  const hideSuffixNoDot = <span className="ml-2">{hideBtn}</span>

  return (
    <div className="animate-fade">
      {m.editedAt ? (
        <EditHistory messageId={m.id} isFromMe={isFromMe} currentContent={m.content} timestamp={m.timestamp} suffix={hideSuffixWithDot} activeSuffix={hideSuffixNoDot} />
      ) : (
        <>
          <div className="text-sm font-medium break-words">{m.content ? <Linkify text={m.content} /> : `[${m.type}]`}</div>
          <div className={`text-xs mt-2 font-medium ${dimClass}`}>
            {new Date(m.timestamp).toLocaleTimeString()}
            <span className="mx-1">·</span>{hideBtn}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function BrutalCard({ children, className = '', color }: { children: React.ReactNode; className?: string; color?: string }) {
  return <div className={`brutal rounded-[var(--radius-lg)] ${className}`} style={color ? { background: color } : { background: 'var(--bg-surface)' }}>{children}</div>
}

function Pill({ children, active, onClick, color }: { children: React.ReactNode; active?: boolean; onClick?: () => void; color?: string }) {
  return <button onClick={onClick} className={`px-4 py-2 rounded-[var(--radius-full)] text-sm font-bold transition-all ${active ? 'brutal-sm text-[var(--text-inverse)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-2 border-transparent hover:border-[var(--border)]'}`}
    style={active ? { background: color || 'var(--accent)' } : undefined}>{children}</button>
}

function Chip({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'amber' | 'teal' | 'violet' | 'rose' | 'default' }) {
  const bg = { amber: 'var(--card-amber)', teal: 'var(--card-teal)', violet: 'var(--card-violet)', rose: 'var(--card-rose)', default: 'var(--bg-inset)' }
  return <span className="px-3 py-1 rounded-[var(--radius-full)] text-xs font-bold border-2 border-[var(--border)]" style={{ background: bg[variant] }}>{children}</span>
}

function BrutalBtn({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`brutal px-5 py-3 rounded-[var(--radius-md)] text-sm font-black transition-all disabled:opacity-50 ${className}`} {...props}>{children}</button>
}

function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`w-full px-4 py-3 rounded-[var(--radius-md)] border-2 border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] text-sm font-medium focus:outline-none focus:shadow-[var(--shadow-brutal-color)] transition-all ${className}`} {...props} />
}

function RefreshBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-10 h-10 rounded-full brutal bg-[var(--bg-surface)] flex items-center justify-center text-[var(--text-secondary)]" title="Refresh">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 1v5h5" /><path d="M15 15v-5h-5" /><path d="M13.5 6A6 6 0 0 0 3 3.5L1 6" /><path d="M2.5 10A6 6 0 0 0 13 12.5l2-2.5" /></svg>
    </button>
  )
}

function PageShell({ title, children, actions, bg }: { title: string; children: React.ReactNode; actions?: React.ReactNode; bg?: string }) {
  return (
    <div className="min-h-[calc(100vh-72px)] transition-colors duration-300" style={bg ? { background: bg } : undefined}>
      <div className="p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-5xl font-black tracking-tight text-[var(--text-primary)]">{title}</h2>
          <div className="flex items-center gap-3">{actions}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Login ───────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const { dark, toggle } = useTheme()
  const [step, setStep] = useState<'send' | 'verify'>('send')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const sendOtp = async () => { setSending(true); setError(''); try { const r = await fetch(`${AUTH}/send-otp`, { method: 'POST', credentials: 'include' }); const d = await r.json(); if (r.ok) setStep('verify'); else setError(d.error) } catch { setError('Connection failed') } setSending(false) }
  const verifyOtp = async () => { setError(''); try { const r = await fetch(`${AUTH}/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), credentials: 'include' }); const d = await r.json(); if (r.ok) onLogin(); else setError(d.error) } catch { setError('Verification failed') } }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--card-amber)' }}>
      <button onClick={toggle} className="fixed top-6 right-6 w-10 h-10 rounded-full brutal bg-[var(--bg-surface)] flex items-center justify-center text-lg z-20">{dark ? '\u2600\ufe0f' : '\ud83c\udf19'}</button>

      <div className="w-full max-w-md animate-in">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-[var(--radius-xl)] brutal bg-[var(--accent)] mb-6">
            <span className="text-5xl font-black text-[var(--text-inverse)]">W</span>
          </div>
          <h1 className="text-7xl font-black tracking-tighter text-[var(--text-primary)]">Companion</h1>
          <p className="text-xl text-[var(--text-secondary)] mt-2 font-medium">Your WhatsApp infrastructure</p>
        </div>

        <BrutalCard className="p-8" color="var(--bg-surface)">
          {step === 'send' ? (
            <BrutalBtn onClick={sendOtp} disabled={sending} className="w-full py-4 text-base bg-[var(--accent)] text-[var(--text-inverse)]">
              {sending ? 'Sending...' : 'Send OTP to WhatsApp'}
            </BrutalBtn>
          ) : (
            <div className="space-y-5">
              <p className="text-center text-[var(--text-secondary)] font-medium">Enter the 6-digit code</p>
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="000000" maxLength={6}
                className="w-full px-6 py-4 rounded-[var(--radius-lg)] border-2 border-[var(--border)] bg-[var(--bg-surface)] text-center text-4xl tracking-[0.5em] font-black focus:outline-none focus:shadow-[var(--shadow-brutal-color)]"
                onKeyDown={e => e.key === 'Enter' && verifyOtp()} autoFocus />
              <BrutalBtn onClick={verifyOtp} className="w-full py-4 text-base bg-[var(--accent)] text-[var(--text-inverse)]">Verify</BrutalBtn>
              <button onClick={() => { setStep('send'); setCode('') }} className="w-full text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] font-medium">Resend</button>
            </div>
          )}
          {error && <p className="mt-4 text-center font-bold" style={{ color: 'var(--error)' }}>{error}</p>}
        </BrutalCard>
      </div>
    </div>
  )
}

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewTab() {
  const [tick, setTick] = useState(0)
  const { data: stats } = useFetch<Stats>(`${API}/stats?_t=${tick}`)
  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 5000); return () => clearInterval(i) }, [])
  if (!stats) return <div className="p-8 text-[var(--text-tertiary)]">Loading...</div>

  return (
    <PageShell title="Overview" actions={<RefreshBtn onClick={() => setTick(t => t + 1)} />} bg="var(--tab-overview)">
      {/* Giant hero */}
      <div className="mb-10 animate-in">
        <p className="text-lg font-bold text-[var(--text-secondary)] mb-2">Total Messages</p>
        <div className="text-[120px] leading-none font-black tracking-tighter text-[var(--text-primary)]">{stats.messages.toLocaleString()}</div>
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 stagger">
        {[
          { v: stats.chats, l: 'Chats', c: 'var(--card-teal)' },
          { v: stats.media, l: 'Media', c: 'var(--card-amber)' },
          { v: stats.apps, l: 'Apps', c: 'var(--card-violet)' },
          { v: stats.deliveries, l: 'Deliveries', c: 'var(--card-rose)' },
        ].map(s => (
          <BrutalCard key={s.l} color={s.c} className="p-6 relative overflow-hidden">
            <div className="text-5xl font-black tracking-tight">{s.v.toLocaleString()}</div>
            <div className="text-base font-bold mt-1 text-[var(--text-secondary)]">{s.l}</div>
            <div className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full border-4 border-[var(--border)] opacity-10" />
          </BrutalCard>
        ))}
      </div>

      {/* Status */}
      <div className="mt-10 flex items-center gap-3 animate-in" style={{ animationDelay: '400ms' }}>
        <span className="w-4 h-4 rounded-full bg-[var(--success)] border-2 border-[var(--border)]" style={{ animation: 'glow-pulse 2s ease-in-out infinite' }} />
        <span className="text-base font-bold text-[var(--text-secondary)]">WhatsApp Connected</span>
      </div>
    </PageShell>
  )
}

// ─── Messages ────────────────────────────────────────────────────────────────

function MessagesTab() {
  const [chats, setChats] = useState<Chat[]>([])
  const [cl, setCl] = useState(true)
  const [chatsExhausted, setChatsExhausted] = useState(false)
  const [loadingMoreChats, setLoadingMoreChats] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [msgs, setMsgs] = useState<Message[]>([])
  const [ml, setMl] = useState(false)
  const [msgsExhausted, setMsgsExhausted] = useState(false)
  const [loadingMoreMsgs, setLoadingMoreMsgs] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const chatListRef = useRef<HTMLDivElement>(null)

  const PAGE = 50

  // Load initial chats
  const loadChats = useCallback(async (showLoading = true) => {
    if (showLoading) setCl(true)
    try {
      const r = await apiFetch(`${API}/chats?limit=${PAGE}`)
      if (r.ok) {
        const data = await r.json() as Chat[]
        setChats(data)
        setChatsExhausted(data.length < PAGE)
      }
    } catch { /* handled by apiFetch */ }
    if (showLoading) setCl(false)
  }, [])

  // Load more chats (older)
  const loadMoreChats = useCallback(async () => {
    if (loadingMoreChats || chatsExhausted || chats.length === 0) return
    setLoadingMoreChats(true)
    const oldest = chats[chats.length - 1]
    try {
      const r = await apiFetch(`${API}/chats?limit=${PAGE}&before=${oldest.lastMessageAt}`)
      if (r.ok) {
        const data = await r.json() as Chat[]
        if (data.length === 0) { setChatsExhausted(true) } else {
          setChats(prev => [...prev, ...data])
          if (data.length < PAGE) setChatsExhausted(true)
        }
      }
    } catch { /* handled */ }
    setLoadingMoreChats(false)
  }, [chats, loadingMoreChats, chatsExhausted])

  // Load messages for selected chat
  const loadMessages = useCallback(async (chatId: string, limit = PAGE, showLoading = true) => {
    if (showLoading) setMl(true); setMsgsExhausted(false)
    try {
      const r = await apiFetch(`${API}/messages?chatId=${chatId}&limit=${limit}`)
      if (r.ok) {
        const data = await r.json() as Message[]
        setMsgs(data)
        setMsgsExhausted(data.length < limit)
      }
    } catch { /* handled */ }
    if (showLoading) setMl(false)
  }, [])

  // Load more messages (older)
  const loadMoreMsgs = useCallback(async () => {
    if (loadingMoreMsgs || msgsExhausted || !sel || msgs.length === 0) return
    setLoadingMoreMsgs(true)
    // msgs are newest-first from API, so last item is the oldest
    const oldest = msgs[msgs.length - 1]
    try {
      const r = await apiFetch(`${API}/messages?chatId=${sel}&limit=${PAGE}&before=${oldest.timestamp}`)
      if (r.ok) {
        const data = await r.json() as Message[]
        if (data.length === 0) { setMsgsExhausted(true) } else {
          setMsgs(prev => [...prev, ...data])
          if (data.length < PAGE) setMsgsExhausted(true)
        }
      }
    } catch { /* handled */ }
    setLoadingMoreMsgs(false)
  }, [sel, msgs, loadingMoreMsgs, msgsExhausted])

  useEffect(() => { loadChats() }, [loadChats])
  useEffect(() => { if (sel) loadMessages(sel) }, [sel, loadMessages])

  // Auto-scroll to bottom on initial chat load (not when loading older messages)
  const shouldScroll = useRef(false)
  useEffect(() => { shouldScroll.current = true }, [sel]) // flag on chat change
  useEffect(() => {
    if (shouldScroll.current && msgs.length > 0 && !ml) {
      messagesEndRef.current?.scrollIntoView()
      shouldScroll.current = false
    }
  }, [msgs, ml])

  // Scroll handlers for infinite loading
  const handleChatScroll = useCallback(() => {
    const el = chatListRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) loadMoreChats()
  }, [loadMoreChats])

  const handleMsgScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    // Load more when scrolling near the top (older messages)
    if (el.scrollTop < 50) loadMoreMsgs()
  }, [loadMoreMsgs])

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const sendMessage = useCallback(async () => {
    if (!sel || !draft.trim() || sending) return
    const chatId = sel
    setSending(true)
    setSendError(null)
    try {
      const r = await apiFetch(`${API}/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, content: draft.trim() }),
      })
      if (r.ok) {
        setDraft('')
        shouldScroll.current = true
        setTimeout(() => loadMessages(chatId, 10, false), 500)
      } else {
        const data = await r.json().catch(() => null)
        setSendError(data?.error || 'Failed to send')
      }
    } catch {
      setSendError('Failed to send')
    }
    setSending(false)
  }, [sel, draft, sending, loadMessages])

  const rc = () => loadChats(false)
  const rm = () => { if (sel) { shouldScroll.current = true; loadMessages(sel, PAGE, false) } }
  const filteredChats = chats.filter(c => !search || (c.name || c.id).toLowerCase().includes(search.toLowerCase()))
  const selectedChat = chats.find(c => c.id === sel)

  return (
    <div className="flex h-[calc(100vh-72px)]" style={{ background: 'var(--tab-messages)' }}>
      <div className="w-80 flex-shrink-0 border-r-2 border-[var(--border)] bg-[var(--bg-surface)] flex flex-col">
        <div className="h-[60px] px-4 flex items-center gap-2 border-b-2 border-[var(--border)] bg-[var(--bg-surface)] sticky top-0 z-10">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats..."
            className="flex-1 px-3 py-2 rounded-[var(--radius-md)] border-2 border-[var(--border)] bg-[var(--bg-surface)] text-sm font-medium placeholder-[var(--text-tertiary)] focus:outline-none focus:shadow-[var(--shadow-brutal-color)]" />
          <RefreshBtn onClick={() => { rc(); if (sel) rm() }} />
        </div>
        <div className="flex-1 overflow-y-auto" ref={chatListRef} onScroll={handleChatScroll}>
        {cl ? <div className="p-4 text-[var(--text-tertiary)] font-medium">Loading...</div> : <>
        {filteredChats.map(c => (
          <button key={c.id} onClick={() => setSel(c.id)}
            className={`w-full text-left px-4 py-3 transition-all ${sel === c.id ? 'bg-[var(--card-amber)] border-l-4 border-l-[var(--accent)]' : 'hover:bg-[var(--bg-surface-hover)]'}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-sm text-[var(--text-primary)] truncate pr-2">{c.name || c.id}</span>
              {c.unreadCount > 0 && <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-[var(--text-inverse)] text-[10px] font-black flex items-center justify-center flex-shrink-0">{c.unreadCount > 99 ? '99' : c.unreadCount}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.isGroup ? 'bg-[var(--card-teal)]' : 'bg-[var(--bg-inset)]'}`}>{c.isGroup ? 'Group' : 'DM'}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">{new Date(c.lastMessageAt).toLocaleDateString()}</span>
            </div>
          </button>
        ))}
        {loadingMoreChats && <div className="p-4 flex justify-center"><div className="w-5 h-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" /></div>}
        </>}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        {sel && selectedChat && (
          <div className="h-[60px] px-6 border-b-2 border-[var(--border)] bg-[var(--bg-surface)] flex items-center gap-3">
            <div>
              <div className="font-black text-sm text-[var(--text-primary)]">{selectedChat.name || selectedChat.id}</div>
              <div className="text-[10px] font-bold text-[var(--text-tertiary)]">{selectedChat.isGroup ? 'Group' : 'DM'}</div>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-10 py-6" ref={messagesContainerRef} onScroll={handleMsgScroll}>
        {!sel ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="text-6xl">💬</div>
              <p className="text-2xl font-bold text-[var(--text-tertiary)]">Select a chat</p>
            </div>
          ) : ml ? <div className="text-[var(--text-tertiary)] font-medium">Loading...</div>
          : !(msgs ?? []).length ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="text-4xl">📭</div>
              <p className="text-lg font-bold text-[var(--text-tertiary)]">No messages</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {loadingMoreMsgs && <div className="p-4 flex justify-center"><div className="w-5 h-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" /></div>}
              {[...msgs].reverse().map(m => (
                <div key={m.id} className={`max-w-[60%] ${m.isFromMe ? 'ml-auto' : ''}`}>
                  <div className={`p-4 rounded-[var(--radius-lg)] border-2 border-[var(--border)] ${m.isFromMe ? 'bg-[var(--accent)] text-white shadow-[var(--shadow-brutal-sm)]' : 'bg-[var(--bg-surface)]'}`}>
                    {!m.isFromMe && <div className="font-black text-xs mb-1" style={{ color: 'var(--secondary)' }}>{m.senderName}</div>}
                    {m.deletedAt ? (
                      <DeletedMessage message={m} isFromMe={m.isFromMe} />
                    ) : m.editedAt ? (
                      <EditHistory messageId={m.id} isFromMe={m.isFromMe} currentContent={m.content} timestamp={m.timestamp} />
                    ) : (
                      <>
                        <div className="text-sm font-medium break-words">{m.content ? <Linkify text={m.content} /> : `[${m.type}]`}</div>
                        <div className={`text-xs mt-2 font-medium ${m.isFromMe ? 'text-white/60' : 'text-[var(--text-tertiary)]'}`}>{new Date(m.timestamp).toLocaleTimeString()}</div>
                      </>
                    )}
                  </div>
                  {m.reactions && m.reactions.length > 0 && (
                    <div className={`flex gap-1 mt-1 ${m.isFromMe ? 'justify-end' : ''}`}>
                      {Object.entries(m.reactions.reduce<Record<string, string[]>>((acc, r) => { (acc[r.emoji] ??= []).push(r.senderName || r.senderId); return acc }, {})).map(([emoji, names]) => (
                        <span key={emoji} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border-2 border-[var(--border)] bg-[var(--bg-surface)] text-xs font-bold cursor-default" title={names.join(', ')}>
                          {emoji}{names.length > 1 && <span className="text-[var(--text-tertiary)]">{names.length}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )
        }
        </div>
        {sendError && <div className="px-4 py-1 text-xs font-bold text-red-500 border-t-2 border-[var(--border)] bg-[var(--bg-surface)]">{sendError}</div>}
        {sel && (
          <div className="h-[60px] px-4 flex items-center gap-2 border-t-2 border-[var(--border)] bg-[var(--bg-surface)]">
              <input
                value={draft}
                onChange={e => { setDraft(e.target.value); setSendError(null) }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="Type a message..."
                disabled={sending}
                className="flex-1 px-3 py-2 rounded-[var(--radius-md)] border-2 border-[var(--border)] bg-[var(--bg-surface)] text-sm font-medium placeholder-[var(--text-tertiary)] focus:outline-none focus:shadow-[var(--shadow-brutal-color)] disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={sending || !draft.trim()}
                className="brutal px-3 py-2 rounded-[var(--radius-md)] bg-[var(--accent)] text-white text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? '...' : '➤'}
              </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Media ───────────────────────────────────────────────────────────────────

const MEDIA_TYPES = ['image', 'video', 'audio', 'document']

function MediaTab() {
  const [tf, setTf] = useState(''); const [sf, setSf] = useState(''); const [snf, setSnf] = useState('')
  const p = new URLSearchParams(); if (tf) p.set('type', tf); if (sf) p.set('source', sf); if (snf) p.set('sender', snf); p.set('limit', '100')
  const { data: media, loading, refetch } = useFetch<Message[]>(`${API}/media?${p}`)

  return (
    <PageShell title="Media" actions={<RefreshBtn onClick={refetch} />} bg="var(--tab-media)">
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div className="flex gap-1">{['', 'chat', 'story'].map(s => <Pill key={s} active={sf === s} onClick={() => setSf(s)}>{s || 'All'}</Pill>)}</div>
        <div className="w-0.5 h-8 bg-[var(--border)]" />
        <div className="flex gap-1">
          <Pill active={!tf} onClick={() => setTf('')} color="var(--secondary)">All</Pill>
          {MEDIA_TYPES.map(t => <Pill key={t} active={tf === t} onClick={() => setTf(t)} color="var(--secondary)">{t}</Pill>)}
        </div>
        <Input value={snf} onChange={e => setSnf(e.target.value)} placeholder="Search sender..." className="w-48 !py-2" />
      </div>

      {loading ? <p className="text-[var(--text-tertiary)] font-medium">Loading...</p>
        : !(media ?? []).length ? <p className="text-[var(--text-tertiary)] font-medium text-xl">No media found.</p>
        : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 stagger">
            {(media ?? []).map(m => (
              <BrutalCard key={m.id} className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <Chip variant="teal">{m.type}</Chip>
                  <Chip variant={m.chatId === 'status@broadcast' ? 'amber' : 'default'}>{m.chatId === 'status@broadcast' ? 'Story' : 'Chat'}</Chip>
                </div>
                <div className="text-sm font-bold text-[var(--text-primary)] truncate">{m.content || m.mimeType || m.type}</div>
                <div className="text-xs font-medium text-[var(--text-tertiary)] mt-2">{m.senderName} &middot; {new Date(m.timestamp).toLocaleDateString()}</div>
              </BrutalCard>
            ))}
          </div>
        )
      }
    </PageShell>
  )
}

// ─── Apps ────────────────────────────────────────────────────────────────────

const EVENTS = ['message.received', 'media.received', 'message.sent', 'message.reaction', 'message.edited', 'message.deleted', 'chat.updated']
const PERMS = ['messages.read', 'chats.read', 'media.read', 'media.download', 'messages.send']

function toggleInArray<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]
}

function ChatPicker({ selected, onChange, scopeChatTypes }: { selected: string[]; onChange: (v: string[]) => void; scopeChatTypes: string[] }) {
  const { data: chats } = useFetch<Chat[]>(`${API}/chats?limit=200`)
  const [open, setOpen] = useState(selected.length > 0)
  const [search, setSearch] = useState('')
  const filtered = (chats ?? [])
    .filter(c => scopeChatTypes.includes(c.isGroup ? 'group' : 'dm'))
    .filter(c => !search || (c.name || c.id).toLowerCase().includes(search.toLowerCase()) || c.id.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    if (!chats || selected.length === 0) return
    const chatMap = new Map(chats.map(c => [c.id, c]))
    const pruned = selected.filter(id => { const c = chatMap.get(id); return c && scopeChatTypes.includes(c.isGroup ? 'group' : 'dm') })
    if (pruned.length !== selected.length) onChange(pruned)
  }, [chats, selected, scopeChatTypes, onChange])

  return (
    <div>
      <button type="button" onClick={() => { if (open) { onChange([]); } setOpen(!open) }} className="text-xs font-bold text-[var(--accent)] hover:underline">
        {open ? 'Remove chat restrictions' : 'Restrict to specific chats'}
        {selected.length > 0 && ` (${selected.length} selected)`}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats..." className="!py-2 !text-xs" />
          <div className="max-h-48 overflow-y-auto space-y-1 border-2 border-[var(--border)] rounded-[var(--radius-md)] p-2">
            {!chats ? <p className="text-xs text-[var(--text-tertiary)]">Loading...</p>
              : filtered.length === 0 ? <p className="text-xs text-[var(--text-tertiary)]">No chats match</p>
              : filtered.map(c => (
                <button key={c.id} type="button" onClick={() => onChange(toggleInArray(selected, c.id))}
                  className={`w-full text-left px-3 py-2 rounded-[var(--radius-sm)] text-xs font-medium transition-all flex items-center gap-2 ${selected.includes(c.id) ? 'bg-[var(--accent)] text-[var(--text-inverse)] brutal-sm' : 'hover:bg-[var(--bg-inset)]'}`}>
                  <span className={`shrink-0 text-[10px] font-black uppercase px-1.5 py-0.5 rounded border border-current ${selected.includes(c.id) ? 'opacity-80' : 'text-[var(--text-tertiary)]'}`}>{c.isGroup ? 'G' : 'DM'}</span>
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.map(id => {
                const chat = (chats ?? []).find(c => c.id === id)
                return <span key={id} className="inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-full)] text-[10px] font-bold bg-[var(--bg-inset)] border border-[var(--border)]">
                  {chat?.name ?? id}
                  <button type="button" onClick={() => onChange(toggleInArray(selected, id))} className="hover:text-[var(--accent)]">&times;</button>
                </span>
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WebhookWarning() {
  return (
    <p className="text-xs font-bold text-[var(--card-amber)] border-2 border-[var(--card-amber)] rounded-[var(--radius-md)] px-3 py-2">
      Events selected without a webhook URL — deliveries will fail until one is added.
    </p>
  )
}

function AppEditForm({ app, onSave, onCancel }: { app: AppRecord; onSave: () => void; onCancel: () => void }) {
  const [wu, setWu] = useState(app.webhookGlobalUrl)
  const [ev, setEv] = useState<string[]>(app.webhookEvents.map(e => e.name))
  const [pm, setPm] = useState<string[]>(app.permissions)
  const [sc, setSc] = useState<string[]>(app.scopeChatTypes)
  const [spc, setSpc] = useState<string[]>(app.scopeSpecificChats)
  const [saving, setSaving] = useState(false)
  const save = async () => { setSaving(true); await apiFetch(`${API}/apps/${app.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webhookGlobalUrl: wu, webhookEvents: ev.map(e => ({ name: e })), permissions: pm, scopeChatTypes: sc, scopeSpecificChats: spc }) }).catch(() => {}); setSaving(false); onSave() }

  return (
    <div className="mt-5 pt-5 border-t-2 border-[var(--border)] space-y-4 animate-in">
      <Input value={wu} onChange={e => setWu(e.target.value)} placeholder="Webhook URL" />
      {ev.length > 0 && !wu && <WebhookWarning />}
      <div><p className="text-xs font-black text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Events</p><div className="flex flex-wrap gap-2">{EVENTS.map(e => <Pill key={e} active={ev.includes(e)} onClick={() => setEv(toggleInArray(ev, e))}>{e}</Pill>)}</div></div>
      <div><p className="text-xs font-black text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Permissions</p><div className="flex flex-wrap gap-2">{PERMS.map(p => <Pill key={p} active={pm.includes(p)} onClick={() => setPm(toggleInArray(pm, p))} color="var(--secondary)">{p}</Pill>)}</div></div>
      <div>
        <p className="text-xs font-black text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Scope</p>
        <div className="flex gap-2 mb-3">{['dm', 'group'].map(s => <Pill key={s} active={sc.includes(s)} onClick={() => setSc(toggleInArray(sc, s))}>{s}</Pill>)}</div>
        <ChatPicker selected={spc} onChange={setSpc} scopeChatTypes={sc} />
      </div>
      <div className="flex gap-3">
        <BrutalBtn onClick={save} disabled={saving} className="bg-[var(--accent)] text-[var(--text-inverse)]">{saving ? 'Saving...' : 'Save'}</BrutalBtn>
        <BrutalBtn onClick={onCancel} className="bg-[var(--bg-inset)]">Cancel</BrutalBtn>
      </div>
    </div>
  )
}

function AppsTab() {
  const { data: apps, loading, refetch } = useFetch<AppRecord[]>(`${API}/apps`)
  const [showForm, setShowForm] = useState(false)
  const [created, setCreated] = useState<AppRecord | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [wu, setWu] = useState('')
  const [ev, setEv] = useState<string[]>([]); const [pm, setPm] = useState<string[]>([]); const [sc, setSc] = useState<string[]>(['dm', 'group']); const [spc, setSpc] = useState<string[]>([])

  const createApp = async () => {
    try { const r = await apiFetch(`${API}/apps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: desc, webhookGlobalUrl: wu || undefined, webhookEvents: ev.length ? ev.map(e => ({ name: e })) : undefined, permissions: pm, scopeChatTypes: sc, scopeSpecificChats: spc }) })
      if (r.ok) { const a = await r.json(); setCreated(a); setShowForm(false); setName(''); setDesc(''); setWu(''); setEv([]); setPm([]); setSpc([]); refetch() }
    } catch { /* 401 handled by apiFetch */ }
  }
  const deactivate = async (id: string) => { await apiFetch(`${API}/apps/${id}`, { method: 'DELETE' }).catch(() => {}); refetch() }

  if (loading) return <div className="p-8 text-[var(--text-tertiary)] font-medium">Loading...</div>

  return (
    <PageShell title="Apps" bg="var(--tab-apps)" actions={<>
      <RefreshBtn onClick={refetch} />
      <BrutalBtn onClick={() => setShowForm(!showForm)} className="bg-[var(--accent)] text-[var(--text-inverse)]">{showForm ? 'Cancel' : '+ New App'}</BrutalBtn>
    </>}>

      {created && (
        <BrutalCard color="var(--card-amber)" className="mb-8 p-6 animate-in">
          <p className="font-black text-lg">{created.name} created</p>
          <p className="text-xs font-medium text-[var(--text-secondary)] mb-4">Copy now — shown once only:</p>
          {[{ l: 'API Key', v: created.apiKey }, { l: 'Secret', v: created.webhookSecret }].map(({ l, v }) => (
            <div key={l} className="flex items-center gap-2 mb-2">
              <span className="text-xs font-black text-[var(--text-tertiary)] w-16">{l}</span>
              <code className="text-xs font-mono bg-[var(--bg-surface)] px-3 py-2 rounded-[var(--radius-sm)] flex-1 break-all border-2 border-[var(--border)]">{v}</code>
              <BrutalBtn onClick={() => navigator.clipboard.writeText(v)} className="text-xs bg-[var(--accent)] text-[var(--text-inverse)] !px-3 !py-1.5">Copy</BrutalBtn>
            </div>
          ))}
          <button onClick={() => setCreated(null)} className="mt-2 text-xs font-medium text-[var(--text-tertiary)]">Dismiss</button>
        </BrutalCard>
      )}

      {showForm && (
        <BrutalCard className="mb-8 p-6 space-y-4 animate-in">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="App name" />
          <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" />
          <Input value={wu} onChange={e => setWu(e.target.value)} placeholder="Webhook URL (optional for API-only)" />
          {ev.length > 0 && !wu && <WebhookWarning />}
          <div><p className="text-xs font-black text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Events</p><div className="flex flex-wrap gap-2">{EVENTS.map(e => <Pill key={e} active={ev.includes(e)} onClick={() => setEv(toggleInArray(ev, e))}>{e}</Pill>)}</div></div>
          <div><p className="text-xs font-black text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Permissions</p><div className="flex flex-wrap gap-2">{PERMS.map(p => <Pill key={p} active={pm.includes(p)} onClick={() => setPm(toggleInArray(pm, p))} color="var(--secondary)">{p}</Pill>)}</div></div>
          <div>
            <p className="text-xs font-black text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Scope</p>
            <div className="flex gap-2 mb-3">{['dm', 'group'].map(s => <Pill key={s} active={sc.includes(s)} onClick={() => setSc(toggleInArray(sc, s))}>{s}</Pill>)}</div>
            <ChatPicker selected={spc} onChange={setSpc} scopeChatTypes={sc} />
          </div>
          <BrutalBtn onClick={createApp} disabled={!name} className="w-full py-4 text-base bg-[var(--accent)] text-[var(--text-inverse)]">Register</BrutalBtn>
        </BrutalCard>
      )}

      <div className="space-y-5 stagger">
        {!(apps ?? []).length ? <p className="text-[var(--text-tertiary)] font-medium text-xl">No apps yet.</p> : (apps ?? []).map(a => (
          <BrutalCard key={a.id} className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <span className="font-black text-xl">{a.name}</span>
                {a.description && <p className="text-xs font-medium text-[var(--text-tertiary)] mt-0.5">{a.description}</p>}
              </div>
              <div className="flex gap-2">
                <BrutalBtn onClick={() => setEditId(editId === a.id ? null : a.id)} className="!px-3 !py-1.5 text-xs bg-[var(--bg-inset)]">{editId === a.id ? 'Close' : 'Edit'}</BrutalBtn>
                <BrutalBtn onClick={() => deactivate(a.id)} className="!px-3 !py-1.5 text-xs bg-[var(--card-rose)]">Remove</BrutalBtn>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {a.webhookEvents.map((e: { name: string }) => <Chip key={e.name} variant="amber">{e.name}</Chip>)}
              {a.permissions.map(p => <Chip key={p} variant="teal">{p}</Chip>)}
            </div>
            <div className="mt-2 text-xs font-mono font-medium text-[var(--text-tertiary)]">Key: {a.apiKey} &middot; Scope: {a.scopeChatTypes.join(', ')}{a.scopeSpecificChats.length > 0 && ` (${a.scopeSpecificChats.length} specific chat${a.scopeSpecificChats.length > 1 ? 's' : ''})`}</div>
            {editId === a.id && <AppEditForm app={a} onSave={() => { setEditId(null); refetch() }} onCancel={() => setEditId(null)} />}
          </BrutalCard>
        ))}
      </div>
    </PageShell>
  )
}

// ─── Logs ────────────────────────────────────────────────────────────────────

function LogsTab() {
  const { data: dels, loading, refetch } = useFetch<Delivery[]>(`${API}/deliveries?limit=200`)
  const { data: apps } = useFetch<AppRecord[]>(`${API}/apps`)
  const [expId, setExpId] = useState<string | null>(null)
  useEffect(() => { const i = setInterval(refetch, 30000); return () => clearInterval(i) }, [refetch])
  const appName = useCallback((id: string) => apps?.find(a => a.id === id)?.name ?? id, [apps])
  const fmt = (r: string) => { try { return JSON.stringify(JSON.parse(r), null, 2) } catch { return r } }
  const sc = (s: string) => s === 'delivered' ? 'teal' as const : s === 'failed' ? 'rose' as const : 'amber' as const

  if (loading) return <div className="p-8 text-[var(--text-tertiary)] font-medium">Loading...</div>

  return (
    <PageShell title="Delivery Logs" actions={<RefreshBtn onClick={refetch} />} bg="var(--tab-logs)">
      {!(dels ?? []).length ? <p className="text-[var(--text-tertiary)] font-medium text-xl">No deliveries yet.</p> : (
        <BrutalCard className="overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-xs font-black text-[var(--text-tertiary)] uppercase tracking-wider bg-[var(--bg-inset)] border-b-2 border-[var(--border)]">
              <th className="px-5 py-4 text-left">Time</th><th className="px-5 py-4 text-left">App</th><th className="px-5 py-4 text-left">Event</th><th className="px-5 py-4 text-left">Status</th><th className="px-5 py-4 text-left">Tries</th><th className="px-5 py-4 text-left">Code</th>
            </tr></thead>
            <tbody>{(dels ?? []).map(d => (<>
              <tr key={d.id} onClick={() => setExpId(expId === d.id ? null : d.id)} className="border-t-2 border-[var(--border-light)] cursor-pointer hover:bg-[var(--bg-surface-hover)] transition-colors">
                <td className="px-5 py-3 text-xs font-medium text-[var(--text-secondary)]">{new Date(d.created_at * 1000).toLocaleString()}</td>
                <td className="px-5 py-3 text-xs font-bold text-[var(--text-primary)]">{appName(d.app_id)}</td>
                <td className="px-5 py-3"><code className="text-xs font-mono font-bold text-[var(--text-secondary)]">{d.event}</code></td>
                <td className="px-5 py-3"><Chip variant={sc(d.status)}>{d.status}</Chip></td>
                <td className="px-5 py-3 text-xs font-bold text-[var(--text-secondary)]">{d.attempts}</td>
                <td className="px-5 py-3 text-xs font-bold text-[var(--text-secondary)]">{d.response_status || '—'}</td>
              </tr>
              {expId === d.id && d.payload && (
                <tr key={`${d.id}-p`} className="border-t-2 border-[var(--border-light)]">
                  <td colSpan={6} className="p-5"><pre className="text-xs font-mono bg-[var(--bg-inset)] rounded-[var(--radius-lg)] p-5 overflow-auto max-h-72 text-[var(--text-secondary)] border-2 border-[var(--border)]">{fmt(d.payload)}</pre></td>
                </tr>
              )}
            </>))}</tbody>
          </table>
        </BrutalCard>
      )}
    </PageShell>
  )
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

interface McpClient { clientId: string; clientName: string; registeredAt: string; activeTokens: number; tokenExpiresAt: string | null }

function McpTab() {
  const { data: clients, loading, refetch } = useFetch<McpClient[]>(`${API}/mcp-clients`)

  if (loading) return <div className="p-8 text-[var(--text-tertiary)] font-medium">Loading...</div>

  return (
    <PageShell title="MCP Clients" actions={<RefreshBtn onClick={refetch} />} bg="var(--tab-mcp)">
      {!(clients ?? []).length ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-4xl">🤖</div>
          <p className="text-lg font-bold text-[var(--text-tertiary)]">No MCP clients connected</p>
          <p className="text-sm text-[var(--text-tertiary)] max-w-md text-center">Connect an AI assistant via <code className="font-mono bg-[var(--bg-inset)] px-2 py-0.5 rounded">claude mcp add --transport http whatsapp {'{url}'}/mcp</code></p>
        </div>
      ) : (
        <div className="grid gap-4">
          {(clients ?? []).map(c => (
            <BrutalCard key={c.clientId} className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-black text-sm text-[var(--text-primary)]">{c.clientName}</div>
                  <div className="text-xs font-medium text-[var(--text-tertiary)] mt-1">
                    Registered {new Date(c.registeredAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {c.tokenExpiresAt && c.activeTokens > 0 && (
                    <span className="text-xs font-medium text-[var(--text-tertiary)]">
                      expires {formatTimeRemaining(c.tokenExpiresAt)}
                    </span>
                  )}
                  <Chip variant={c.activeTokens > 0 ? 'teal' : 'amber'}>
                    {c.activeTokens > 0 ? `${c.activeTokens} active` : 'no active tokens'}
                  </Chip>
                </div>
              </div>
              <div className="mt-2 text-xs font-mono text-[var(--text-tertiary)]">{c.clientId}</div>
            </BrutalCard>
          ))}
        </div>
      )}
    </PageShell>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'messages', label: 'Messages' },
  { id: 'media', label: 'Media' },
  { id: 'apps', label: 'Apps' },
  { id: 'logs', label: 'Logs' },
  { id: 'mcp', label: 'MCP' },
]

export default function App() {
  const { dark, toggle } = useTheme()
  const [auth, setAuth] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('overview')

  // Wire global 401 handler
  useEffect(() => { onSessionExpired = () => setAuth(false); return () => { onSessionExpired = null } }, [])

  useEffect(() => { fetch(`${API}/auth/check`, { credentials: 'include' }).then(r => r.json()).then(d => setAuth(d.authenticated)).catch(() => setAuth(false)) }, [])

  if (auth === null) return <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center"><div className="w-10 h-10 rounded-full border-4 border-[var(--accent)] border-t-transparent animate-spin" /></div>
  if (!auth) return <LoginScreen onLogin={() => setAuth(true)} />

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      <nav className="flex items-center justify-between px-6 h-[72px] bg-[var(--bg-surface)] border-b-2 border-[var(--border)] sticky top-0 z-50">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-md)] brutal bg-[var(--accent)] flex items-center justify-center">
              <span className="text-base font-black text-[var(--text-inverse)]">W</span>
            </div>
            <span className="text-2xl font-black text-[var(--text-primary)] tracking-tight">Companion</span>
            <span className="w-3 h-3 rounded-full bg-[var(--success)] border-2 border-[var(--border)]" style={{ animation: 'glow-pulse 2s ease-in-out infinite' }} />
          </div>

          <div className="flex gap-2">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-[var(--radius-full)] text-sm font-bold transition-all duration-200 ${tab === t.id ? 'brutal bg-[var(--accent)] text-[var(--text-inverse)]' : 'brutal-sm bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={toggle} className="w-10 h-10 rounded-full brutal bg-[var(--bg-surface)] flex items-center justify-center text-lg">
          {dark ? '\u2600\ufe0f' : '\ud83c\udf19'}
        </button>
      </nav>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'messages' && <MessagesTab />}
      {tab === 'media' && <MediaTab />}
      {tab === 'apps' && <AppsTab />}
      {tab === 'logs' && <LogsTab />}
      {tab === 'mcp' && <McpTab />}
    </div>
  )
}
