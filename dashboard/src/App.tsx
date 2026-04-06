import { useState, useEffect, useCallback } from 'react'

type Tab = 'overview' | 'messages' | 'media' | 'apps' | 'logs'

const API = '/dashboard/api'
const AUTH = '/dashboard/auth'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Chat { id: string; name: string; isGroup: boolean; lastMessageAt: string; unreadCount: number }
interface Message { id: string; chatId: string; senderName: string; content: string; type: string; mimeType?: string; timestamp: string; isFromMe: boolean; isGroup: boolean; groupName?: string }
interface AppRecord { id: string; name: string; description: string; webhookGlobalUrl: string; webhookSecret: string; webhookEvents: { name: string; url?: string }[]; apiKey: string; permissions: string[]; scopeChatTypes: string[]; scopeSpecificChats: string[]; active: boolean; createdAt: string }
interface Delivery { id: string; app_id: string; event: string; payload: string; status: string; attempts: number; last_attempt_at: number; response_status: number; created_at: number }
interface Stats { messages: number; chats: number; media: number; apps: number; deliveries: number }

// ─── Theme ───────────────────────────────────────────────────────────────────

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches))
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('theme', dark ? 'dark' : 'light') }, [dark])
  return { dark, toggle: () => setDark(d => !d) }
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchKey, setFetchKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    const c = new AbortController()
    fetch(url, { credentials: 'include', signal: c.signal })
      .then(r => r.ok ? r.json() : null)
      .then((d: T | null) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false) } })
    return () => { cancelled = true; c.abort() }
  }, [url, fetchKey])
  const refetch = useCallback(() => setFetchKey(k => k + 1), [])
  return { data, loading, refetch }
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function Pill({ children, active, onClick, color }: { children: React.ReactNode; active?: boolean; onClick?: () => void; color?: string }) {
  return <button onClick={onClick} className={`px-4 py-2 rounded-[var(--radius-full)] text-sm font-medium transition-all duration-200 ${active ? 'text-[var(--text-inverse)] shadow-[var(--shadow-color)] scale-105' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-inset)] hover:bg-[var(--bg-surface-hover)]'}`}
    style={active ? { background: color || 'var(--accent)' } : undefined}>{children}</button>
}

function Chip({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'amber' | 'teal' | 'violet' | 'rose' | 'default' }) {
  const bg = { amber: 'var(--card-amber)', teal: 'var(--card-teal)', violet: 'var(--card-violet)', rose: 'var(--card-rose)', default: 'var(--bg-inset)' }
  return <span className="px-3 py-1 rounded-[var(--radius-full)] text-xs font-semibold" style={{ background: bg[variant] }}>{children}</span>
}

function BigNumber({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="rounded-[var(--radius-xl)] p-6 relative overflow-hidden transition-all hover:scale-[1.02] duration-200" style={{ background: color }}>
      <div className="text-4xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{value.toLocaleString()}</div>
      <div className="text-sm font-medium mt-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      {/* Decorative circle */}
      <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-20" style={{ background: 'var(--text-primary)' }} />
    </div>
  )
}

function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`w-full px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] text-sm focus:outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] transition-all ${className}`} {...props} />
}

function RefreshBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-9 h-9 rounded-full bg-[var(--bg-inset)] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] hover:rotate-180 transition-all duration-300" title="Refresh">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 1v5h5" /><path d="M15 15v-5h-5" /><path d="M13.5 6A6 6 0 0 0 3 3.5L1 6" /><path d="M2.5 10A6 6 0 0 0 13 12.5l2-2.5" /></svg>
    </button>
  )
}

function PageShell({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">{title}</h2>
        <div className="flex items-center gap-3">{actions}</div>
      </div>
      {children}
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
    <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-[-30%] right-[-15%] w-[600px] h-[600px] rounded-full opacity-30 blur-[120px] animate-float" style={{ background: 'var(--accent)' }} />
      <div className="absolute bottom-[-25%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-[100px]" style={{ background: 'var(--secondary)' }} />

      <button onClick={toggle} className="fixed top-6 right-6 w-10 h-10 rounded-full glass border flex items-center justify-center text-lg z-20">{dark ? '\u2600\ufe0f' : '\ud83c\udf19'}</button>

      <div className="w-full max-w-md animate-in relative z-10">
        {/* Giant brand */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-[var(--radius-xl)] mb-6 shadow-[var(--shadow-lg)]" style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
            <span className="text-3xl font-bold text-white">W</span>
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-[var(--text-primary)]">Companion</h1>
          <p className="text-lg text-[var(--text-secondary)] mt-2">Your WhatsApp infrastructure</p>
        </div>

        <div className="glass border rounded-[var(--radius-xl)] p-8">
          {step === 'send' ? (
            <button onClick={sendOtp} disabled={sending}
              className="w-full py-4 rounded-[var(--radius-lg)] text-base font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[var(--shadow-color)]"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}>
              {sending ? 'Sending...' : 'Send OTP to WhatsApp'}
            </button>
          ) : (
            <div className="space-y-5">
              <p className="text-center text-[var(--text-secondary)]">Enter the 6-digit code</p>
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="000000" maxLength={6}
                className="w-full px-6 py-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] text-center text-3xl tracking-[0.5em] font-bold focus:outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                onKeyDown={e => e.key === 'Enter' && verifyOtp()} autoFocus />
              <button onClick={verifyOtp}
                className="w-full py-4 rounded-[var(--radius-lg)] text-base font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}>Verify</button>
              <button onClick={() => { setStep('send'); setCode('') }} className="w-full text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Resend</button>
            </div>
          )}
          {error && <p className="mt-4 text-center font-medium" style={{ color: 'var(--error)' }}>{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Overview Tab (NEW — bento stats) ────────────────────────────────────────

function OverviewTab() {
  const [tick, setTick] = useState(0)
  const { data: stats } = useFetch<Stats>(`${API}/stats?_t=${tick}`)
  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 5000); return () => clearInterval(i) }, [])

  if (!stats) return <p className="p-8 text-[var(--text-tertiary)]">Loading...</p>

  return (
    <PageShell title="Overview" actions={<RefreshBtn onClick={() => setTick(t => t + 1)} />}>
      {/* Hero number */}
      <div className="mb-8 animate-in">
        <p className="text-sm font-medium text-[var(--text-tertiary)] mb-1">Total Messages</p>
        <div className="text-7xl font-bold tracking-tighter text-[var(--text-primary)]">{stats.messages.toLocaleString()}</div>
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-4 gap-4 stagger">
        <BigNumber value={stats.chats} label="Chats" color="var(--card-teal)" />
        <BigNumber value={stats.media} label="Media Files" color="var(--card-amber)" />
        <BigNumber value={stats.apps} label="Connected Apps" color="var(--card-violet)" />
        <BigNumber value={stats.deliveries} label="Webhook Deliveries" color="var(--card-rose)" />
      </div>

      {/* Status */}
      <div className="mt-8 flex items-center gap-3 animate-in" style={{ animationDelay: '300ms' }}>
        <span className="w-3 h-3 rounded-full bg-[var(--success)]" style={{ animation: 'glow-pulse 2s ease-in-out infinite' }} />
        <span className="text-sm font-medium text-[var(--text-secondary)]">WhatsApp Connected</span>
      </div>
    </PageShell>
  )
}

// ─── Messages Tab ────────────────────────────────────────────────────────────

function MessagesTab() {
  const { data: chats, loading: cl, refetch: rc } = useFetch<Chat[]>(`${API}/chats`)
  const [sel, setSel] = useState<string | null>(null)
  const { data: msgs, loading: ml, refetch: rm } = useFetch<Message[]>(sel ? `${API}/messages?chatId=${sel}&limit=100` : `${API}/messages?limit=100`)

  return (
    <div className="flex h-[calc(100vh-72px)]">
      {/* Sidebar */}
      <div className="w-80 border-r border-[var(--border)] bg-[var(--bg-surface)] overflow-y-auto">
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Chats</span>
          <RefreshBtn onClick={() => { rc(); rm() }} />
        </div>
        {cl ? <div className="p-4 text-[var(--text-tertiary)]">Loading...</div> : (chats ?? []).map(c => (
          <button key={c.id} onClick={() => setSel(c.id)}
            className={`w-full text-left px-4 py-3.5 border-b border-[var(--border-light)] transition-all ${sel === c.id ? 'bg-[var(--accent-soft)] border-l-2 border-l-[var(--accent)]' : 'hover:bg-[var(--bg-surface-hover)]'}`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-[var(--text-primary)] truncate">{c.name || c.id}</span>
              <Chip variant={c.isGroup ? 'teal' : 'default'}>{c.isGroup ? 'Group' : 'DM'}</Chip>
            </div>
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-10 py-6 bg-[var(--bg-base)]">
        {ml ? <div className="text-[var(--text-tertiary)]">Loading...</div>
          : !(msgs ?? []).length ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="w-16 h-16 rounded-full bg-[var(--bg-inset)] flex items-center justify-center"><span className="text-2xl">💬</span></div>
              <p className="text-[var(--text-tertiary)] text-lg">Select a chat</p>
            </div>
          ) : (
            <div className="flex flex-col-reverse gap-2">
              {(msgs ?? []).map(m => (
                <div key={m.id} className={`max-w-[60%] ${m.isFromMe ? 'ml-auto' : ''}`}>
                  <div className={`p-4 rounded-[var(--radius-lg)] ${m.isFromMe ? 'rounded-br-[4px]' : 'rounded-bl-[4px]'} ${m.isFromMe ? 'text-white' : 'bg-[var(--bg-surface)] border border-[var(--border)]'}`}
                    style={m.isFromMe ? { background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' } : undefined}>
                    {!m.isFromMe && <div className="font-bold text-xs mb-1" style={{ color: 'var(--secondary)' }}>{m.senderName}</div>}
                    <div className="text-sm">{m.content || `[${m.type}]`}</div>
                    <div className={`text-xs mt-2 ${m.isFromMe ? 'opacity-70' : 'text-[var(--text-tertiary)]'}`}>{new Date(m.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>
    </div>
  )
}

// ─── Media Tab ───────────────────────────────────────────────────────────────

const MEDIA_TYPES = ['image', 'video', 'audio', 'document']

function MediaTab() {
  const [tf, setTf] = useState(''); const [sf, setSf] = useState(''); const [snf, setSnf] = useState('')
  const p = new URLSearchParams(); if (tf) p.set('type', tf); if (sf) p.set('source', sf); if (snf) p.set('sender', snf); p.set('limit', '100')
  const { data: media, loading, refetch } = useFetch<Message[]>(`${API}/media?${p}`)

  return (
    <PageShell title="Media" actions={<RefreshBtn onClick={refetch} />}>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex gap-1">
          {['', 'chat', 'story'].map(s => <Pill key={s} active={sf === s} onClick={() => setSf(s)}>{s || 'All'}</Pill>)}
        </div>
        <div className="w-px h-6 bg-[var(--border)]" />
        <div className="flex gap-1">
          <Pill active={!tf} onClick={() => setTf('')} color="var(--secondary)">All</Pill>
          {MEDIA_TYPES.map(t => <Pill key={t} active={tf === t} onClick={() => setTf(t)} color="var(--secondary)">{t}</Pill>)}
        </div>
        <Input value={snf} onChange={e => setSnf(e.target.value)} placeholder="Search sender..." className="w-48 !py-2" />
      </div>

      {loading ? <p className="text-[var(--text-tertiary)]">Loading...</p>
        : !(media ?? []).length ? <p className="text-[var(--text-tertiary)]">No media found.</p>
        : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 stagger">
            {(media ?? []).map(m => (
              <div key={m.id} className="rounded-[var(--radius-lg)] p-4 border border-[var(--border)] bg-[var(--bg-surface)] hover:scale-[1.03] hover:shadow-[var(--shadow-md)] transition-all duration-200 cursor-default">
                <div className="flex items-center justify-between mb-3">
                  <Chip variant="teal">{m.type}</Chip>
                  <Chip variant={m.chatId === 'status@broadcast' ? 'amber' : 'default'}>{m.chatId === 'status@broadcast' ? 'Story' : 'Chat'}</Chip>
                </div>
                <div className="text-sm font-medium text-[var(--text-primary)] truncate">{m.content || m.mimeType || m.type}</div>
                <div className="text-xs text-[var(--text-tertiary)] mt-2">{m.senderName} &middot; {new Date(m.timestamp).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )
      }
    </PageShell>
  )
}

// ─── Apps Tab ────────────────────────────────────────────────────────────────

const EVENTS = ['message.received', 'media.received', 'message.sent', 'chat.updated']
const PERMS = ['messages.read', 'chats.read', 'media.read', 'media.download', 'messages.send']

function AppEditForm({ app, onSave, onCancel }: { app: AppRecord; onSave: () => void; onCancel: () => void }) {
  const [wu, setWu] = useState(app.webhookGlobalUrl)
  const [ev, setEv] = useState<string[]>(app.webhookEvents.map(e => e.name))
  const [pm, setPm] = useState<string[]>(app.permissions)
  const [sc, setSc] = useState<string[]>(app.scopeChatTypes)
  const [saving, setSaving] = useState(false)
  const t = (a: string[], v: string, s: (x: string[]) => void) => s(a.includes(v) ? a.filter(i => i !== v) : [...a, v])

  const save = async () => { setSaving(true); await fetch(`${API}/apps/${app.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ webhookGlobalUrl: wu, webhookEvents: ev.map(e => ({ name: e })), permissions: pm, scopeChatTypes: sc }) }); setSaving(false); onSave() }

  return (
    <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-4 animate-in">
      <Input value={wu} onChange={e => setWu(e.target.value)} placeholder="Webhook URL" />
      <div><p className="text-xs font-bold text-[var(--text-tertiary)] uppercase mb-2">Events</p><div className="flex flex-wrap gap-2">{EVENTS.map(e => <Pill key={e} active={ev.includes(e)} onClick={() => t(ev, e, setEv)}>{e}</Pill>)}</div></div>
      <div><p className="text-xs font-bold text-[var(--text-tertiary)] uppercase mb-2">Permissions</p><div className="flex flex-wrap gap-2">{PERMS.map(p => <Pill key={p} active={pm.includes(p)} onClick={() => t(pm, p, setPm)} color="var(--secondary)">{p}</Pill>)}</div></div>
      <div><p className="text-xs font-bold text-[var(--text-tertiary)] uppercase mb-2">Scope</p><div className="flex gap-2">{['dm', 'group'].map(s => <Pill key={s} active={sc.includes(s)} onClick={() => t(sc, s, setSc)}>{s}</Pill>)}</div></div>
      <div className="flex gap-3">
        <button onClick={save} disabled={saving} className="px-6 py-2.5 rounded-[var(--radius-full)] text-sm font-bold text-white transition-all hover:scale-105 active:scale-95" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}>{saving ? 'Saving...' : 'Save'}</button>
        <button onClick={onCancel} className="px-6 py-2.5 rounded-[var(--radius-full)] text-sm font-medium bg-[var(--bg-inset)] text-[var(--text-secondary)]">Cancel</button>
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
  const [ev, setEv] = useState<string[]>([]); const [pm, setPm] = useState<string[]>([]); const [sc, setSc] = useState<string[]>(['dm', 'group'])
  const t = (a: string[], v: string, s: (x: string[]) => void) => s(a.includes(v) ? a.filter(i => i !== v) : [...a, v])

  const createApp = async () => {
    try { const r = await fetch(`${API}/apps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name, description: desc, webhookGlobalUrl: wu || undefined, webhookEvents: ev.length ? ev.map(e => ({ name: e })) : undefined, permissions: pm, scopeChatTypes: sc, scopeSpecificChats: [] }) })
      if (r.ok) { const a = await r.json(); setCreated(a); setShowForm(false); setName(''); setDesc(''); setWu(''); setEv([]); setPm([]); refetch() }
    } catch (e) { console.error(e) }
  }
  const deactivate = async (id: string) => { await fetch(`${API}/apps/${id}`, { method: 'DELETE', credentials: 'include' }); refetch() }

  if (loading) return <div className="p-8 text-[var(--text-tertiary)]">Loading...</div>

  return (
    <PageShell title="Apps" actions={<>
      <RefreshBtn onClick={refetch} />
      <button onClick={() => setShowForm(!showForm)} className="px-5 py-2.5 rounded-[var(--radius-full)] text-sm font-bold text-white shadow-[var(--shadow-color)] hover:scale-105 active:scale-95 transition-all" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}>
        {showForm ? 'Cancel' : '+ New App'}
      </button>
    </>}>

      {created && (
        <div className="mb-6 p-6 rounded-[var(--radius-xl)] border-2 border-[var(--accent)] animate-in" style={{ background: 'var(--card-amber)' }}>
          <p className="font-bold text-[var(--text-primary)] mb-1">{created.name} created</p>
          <p className="text-xs text-[var(--text-secondary)] mb-4">Copy these now — shown only once:</p>
          {[{ l: 'API Key', v: created.apiKey }, { l: 'Secret', v: created.webhookSecret }].map(({ l, v }) => (
            <div key={l} className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-[var(--text-tertiary)] w-16">{l}</span>
              <code className="text-xs font-mono bg-[var(--bg-surface)] px-3 py-2 rounded-[var(--radius-md)] flex-1 break-all border border-[var(--border)]">{v}</code>
              <button onClick={() => navigator.clipboard.writeText(v)} className="px-3 py-1.5 rounded-[var(--radius-full)] text-xs font-bold bg-[var(--accent)] text-white hover:scale-105 transition-all">Copy</button>
            </div>
          ))}
          <button onClick={() => setCreated(null)} className="mt-2 text-xs text-[var(--text-tertiary)]">Dismiss</button>
        </div>
      )}

      {showForm && (
        <div className="mb-8 p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--border)] space-y-4 animate-in">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="App name" />
          <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" />
          <Input value={wu} onChange={e => setWu(e.target.value)} placeholder="Webhook URL (optional for API-only)" />
          <div><p className="text-xs font-bold text-[var(--text-tertiary)] uppercase mb-2">Events</p><div className="flex flex-wrap gap-2">{EVENTS.map(e => <Pill key={e} active={ev.includes(e)} onClick={() => t(ev, e, setEv)}>{e}</Pill>)}</div></div>
          <div><p className="text-xs font-bold text-[var(--text-tertiary)] uppercase mb-2">Permissions</p><div className="flex flex-wrap gap-2">{PERMS.map(p => <Pill key={p} active={pm.includes(p)} onClick={() => t(pm, p, setPm)} color="var(--secondary)">{p}</Pill>)}</div></div>
          <div><p className="text-xs font-bold text-[var(--text-tertiary)] uppercase mb-2">Scope</p><div className="flex gap-2">{['dm', 'group'].map(s => <Pill key={s} active={sc.includes(s)} onClick={() => t(sc, s, setSc)}>{s}</Pill>)}</div></div>
          <button onClick={createApp} disabled={!name || (ev.length > 0 && !wu)} className="w-full py-3.5 rounded-[var(--radius-lg)] text-base font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}>Register</button>
        </div>
      )}

      <div className="space-y-4 stagger">
        {!(apps ?? []).length ? <p className="text-[var(--text-tertiary)]">No apps yet.</p> : (apps ?? []).map(a => (
          <div key={a.id} className="p-5 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--border)] hover:shadow-[var(--shadow-md)] transition-all">
            <div className="flex items-start justify-between">
              <div>
                <span className="font-bold text-lg text-[var(--text-primary)]">{a.name}</span>
                {a.description && <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{a.description}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditId(editId === a.id ? null : a.id)} className="px-3 py-1.5 rounded-[var(--radius-full)] text-xs font-semibold bg-[var(--bg-inset)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]">{editId === a.id ? 'Close' : 'Edit'}</button>
                <button onClick={() => deactivate(a.id)} className="px-3 py-1.5 rounded-[var(--radius-full)] text-xs font-semibold" style={{ background: 'var(--error-soft)', color: 'var(--error)' }}>Remove</button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {a.webhookEvents.map((e: { name: string }) => <Chip key={e.name} variant="amber">{e.name}</Chip>)}
              {a.permissions.map(p => <Chip key={p} variant="teal">{p}</Chip>)}
            </div>
            <div className="mt-2 text-xs text-[var(--text-tertiary)] font-mono">Key: {a.apiKey} &middot; Scope: {a.scopeChatTypes.join(', ')}</div>
            {editId === a.id && <AppEditForm app={a} onSave={() => { setEditId(null); refetch() }} onCancel={() => setEditId(null)} />}
          </div>
        ))}
      </div>
    </PageShell>
  )
}

// ─── Logs Tab ────────────────────────────────────────────────────────────────

function LogsTab() {
  const { data: dels, loading, refetch } = useFetch<Delivery[]>(`${API}/deliveries?limit=200`)
  const { data: apps } = useFetch<AppRecord[]>(`${API}/apps`)
  const [expId, setExpId] = useState<string | null>(null)
  useEffect(() => { const i = setInterval(refetch, 30000); return () => clearInterval(i) }, [refetch])
  const appName = useCallback((id: string) => apps?.find(a => a.id === id)?.name ?? id, [apps])
  const fmt = (r: string) => { try { return JSON.stringify(JSON.parse(r), null, 2) } catch { return r } }
  const sc = (s: string) => s === 'delivered' ? 'teal' as const : s === 'failed' ? 'rose' as const : 'amber' as const

  if (loading) return <div className="p-8 text-[var(--text-tertiary)]">Loading...</div>

  return (
    <PageShell title="Delivery Logs" actions={<RefreshBtn onClick={refetch} />}>
      {!(dels ?? []).length ? <p className="text-[var(--text-tertiary)]">No deliveries yet.</p> : (
        <div className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-wider bg-[var(--bg-inset)]">
              <th className="px-5 py-3 text-left">Time</th><th className="px-5 py-3 text-left">App</th><th className="px-5 py-3 text-left">Event</th><th className="px-5 py-3 text-left">Status</th><th className="px-5 py-3 text-left">Tries</th><th className="px-5 py-3 text-left">Code</th>
            </tr></thead>
            <tbody>{(dels ?? []).map(d => (<>
              <tr key={d.id} onClick={() => setExpId(expId === d.id ? null : d.id)} className="border-t border-[var(--border-light)] cursor-pointer hover:bg-[var(--bg-surface-hover)] transition-colors">
                <td className="px-5 py-3 text-xs text-[var(--text-secondary)]">{new Date(d.created_at * 1000).toLocaleString()}</td>
                <td className="px-5 py-3 text-xs font-semibold text-[var(--text-primary)]">{appName(d.app_id)}</td>
                <td className="px-5 py-3"><code className="text-xs font-mono text-[var(--text-secondary)]">{d.event}</code></td>
                <td className="px-5 py-3"><Chip variant={sc(d.status)}>{d.status}</Chip></td>
                <td className="px-5 py-3 text-xs text-[var(--text-secondary)]">{d.attempts}</td>
                <td className="px-5 py-3 text-xs text-[var(--text-secondary)]">{d.response_status || '—'}</td>
              </tr>
              {expId === d.id && d.payload && (
                <tr key={`${d.id}-p`} className="border-t border-[var(--border-light)]">
                  <td colSpan={6} className="p-5"><pre className="text-xs font-mono bg-[var(--bg-inset)] rounded-[var(--radius-lg)] p-5 overflow-auto max-h-72 text-[var(--text-secondary)]">{fmt(d.payload)}</pre></td>
                </tr>
              )}
            </>))}</tbody>
          </table>
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
]

export default function App() {
  const { dark, toggle } = useTheme()
  const [auth, setAuth] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => { fetch(`${API}/auth/check`, { credentials: 'include' }).then(r => r.json()).then(d => setAuth(d.authenticated)).catch(() => setAuth(false)) }, [])

  if (auth === null) return <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" /></div>
  if (!auth) return <LoginScreen onLogin={() => setAuth(true)} />

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      <nav className="flex items-center justify-between px-6 h-[72px] glass border-b border-[var(--border)] sticky top-0 z-50">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[var(--radius-md)] flex items-center justify-center shadow-[var(--shadow-color)]" style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
              <span className="text-sm font-black text-white">W</span>
            </div>
            <span className="text-xl font-bold text-[var(--text-primary)] tracking-tight">Companion</span>
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--success)] ml-1" style={{ animation: 'glow-pulse 2s ease-in-out infinite' }} />
          </div>

          <div className="flex gap-1 bg-[var(--bg-inset)] rounded-[var(--radius-full)] p-1">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-[var(--radius-full)] text-sm font-semibold transition-all duration-200 ${tab === t.id ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={toggle} className="w-10 h-10 rounded-full bg-[var(--bg-inset)] flex items-center justify-center text-lg hover:bg-[var(--bg-surface-hover)] transition-all hover:scale-110">
          {dark ? '\u2600\ufe0f' : '\ud83c\udf19'}
        </button>
      </nav>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'messages' && <MessagesTab />}
      {tab === 'media' && <MediaTab />}
      {tab === 'apps' && <AppsTab />}
      {tab === 'logs' && <LogsTab />}
    </div>
  )
}
