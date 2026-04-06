import { useState, useEffect, useCallback } from 'react'

type Tab = 'messages' | 'media' | 'apps' | 'logs'

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
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  return { dark, toggle: () => setDark(d => !d) }
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchKey, setFetchKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    fetch(url, { credentials: 'include', signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then((d: T | null) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false) } })
    return () => { cancelled = true; controller.abort() }
  }, [url, fetchKey])

  const refetch = useCallback(() => setFetchKey(k => k + 1), [])
  return { data, loading, refetch }
}

// ─── Shared Components ───────────────────────────────────────────────────────

function Card({ children, className = '', glass = false }: { children: React.ReactNode; className?: string; glass?: boolean }) {
  const base = glass
    ? 'rounded-[var(--radius-lg)] border border-[var(--glass-border)] shadow-[var(--shadow-sm)] relative noise'
    : 'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]'
  const glassStyle = glass ? { background: 'var(--glass-bg)', backdropFilter: `blur(var(--glass-blur))`, WebkitBackdropFilter: `blur(var(--glass-blur))` } : undefined
  return <div className={`${base} hover:shadow-[var(--shadow-md)] transition-all duration-200 ${className}`} style={glassStyle}>{children}</div>
}

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <Card glass className={className}>{children}</Card>
}

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'accent' | 'secondary' | 'success' | 'error' }) {
  const colors = {
    default: 'bg-[var(--bg-inset)] text-[var(--text-secondary)]',
    accent: 'bg-[var(--accent-soft)] text-[var(--accent-text)]',
    secondary: 'bg-[var(--secondary-soft)] text-[var(--secondary-text)]',
    success: 'bg-[var(--success-soft)] text-green-700 dark:text-green-400',
    error: 'bg-[var(--error-soft)] text-red-700 dark:text-red-400',
  }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[variant]}`}>{children}</span>
}

function Btn({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const styles = {
    primary: 'bg-[var(--accent)] text-[var(--text-inverse)] hover:bg-[var(--accent-hover)] font-semibold shadow-[var(--shadow-sm)] hover:shadow-[0_0_20px_var(--accent-glow)] active:scale-[0.98]',
    secondary: 'bg-[var(--bg-inset)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border)] active:scale-[0.98]',
    ghost: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]',
  }
  return <button className={`px-4 py-2 rounded-[var(--radius-md)] text-sm transition-all duration-200 ${styles[variant]} disabled:opacity-50 ${className}`} {...props}>{children}</button>
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`}
      style={{ animation: connected ? 'glow-pulse 2s ease-in-out infinite' : 'glow-pulse-error 2s ease-in-out infinite' }} />
  )
}

function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`w-full px-4 py-2.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] transition-all ${className}`} {...props} />
}

function ChipSelect({ options, selected, onToggle, color = 'accent' }: { options: string[]; selected: string[]; onToggle: (v: string) => void; color?: 'accent' | 'secondary' }) {
  const active = color === 'accent'
    ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] border-[var(--accent)]'
    : 'bg-[var(--secondary-soft)] text-[var(--secondary-text)] border-[var(--secondary)]'
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button key={o} onClick={() => onToggle(o)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${selected.includes(o) ? active : 'border-[var(--border)] text-[var(--text-tertiary)] hover:border-[var(--text-secondary)]'}`}>{o}</button>
      ))}
    </div>
  )
}

function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h2 className="text-xl font-bold text-[var(--text-primary)]">{title}</h2>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

// ─── Login Screen ────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const { dark, toggle } = useTheme()
  const [step, setStep] = useState<'send' | 'verify'>('send')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const sendOtp = async () => {
    setSending(true); setError('')
    try {
      const res = await fetch(`${AUTH}/send-otp`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (res.ok) setStep('verify'); else setError(data.error)
    } catch { setError('Failed to connect to server') }
    setSending(false)
  }

  const verifyOtp = async () => {
    setError('')
    try {
      const res = await fetch(`${AUTH}/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), credentials: 'include' })
      const data = await res.json()
      if (res.ok) onLogin(); else setError(data.error)
    } catch { setError('Failed to verify') }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background gradient orbs */}
      <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-[100px]" style={{ background: 'var(--gradient-accent)' }} />
      <div className="absolute bottom-[-20%] left-[-10%] w-[400px] h-[400px] rounded-full opacity-15 blur-[100px]" style={{ background: 'var(--gradient-secondary)' }} />

      <button onClick={toggle} className="fixed top-4 right-4 p-2 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)] z-10">
        {dark ? '\u2600\ufe0f' : '\ud83c\udf19'}
      </button>
      <GlassCard className="p-8 w-full max-w-sm animate-in relative z-10">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-[var(--radius-xl)] flex items-center justify-center mx-auto mb-4 gradient-border" style={{ background: 'var(--gradient-accent)' }}>
            <span className="text-2xl font-bold text-white">WA</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">WA Companion</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Login via WhatsApp OTP</p>
        </div>

        {step === 'send' ? (
          <Btn onClick={sendOtp} disabled={sending} className="w-full py-3">
            {sending ? 'Sending...' : 'Send OTP to WhatsApp'}
          </Btn>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)] text-center">Enter the 6-digit code sent to your WhatsApp</p>
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder="000000" maxLength={6}
              className="text-center text-2xl tracking-[0.5em] font-mono"
              onKeyDown={e => e.key === 'Enter' && verifyOtp()} autoFocus />
            <Btn onClick={verifyOtp} className="w-full py-3">Verify</Btn>
            <button onClick={() => { setStep('send'); setCode(''); setError('') }}
              className="w-full text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Resend code</button>
          </div>
        )}
        {error && <p className="mt-4 text-sm text-center" style={{ color: 'var(--error)' }}>{error}</p>}
      </GlassCard>
    </div>
  )
}

// ─── Messages Tab ────────────────────────────────────────────────────────────

function MessagesTab() {
  const { data: chats, loading: chatsLoading, refetch: refetchChats } = useFetch<Chat[]>(`${API}/chats`)
  const [selectedChat, setSelectedChat] = useState<string | null>(null)
  const { data: messages, loading: msgsLoading, refetch: refetchMsgs } = useFetch<Message[]>(
    selectedChat ? `${API}/messages?chatId=${selectedChat}&limit=100` : `${API}/messages?limit=100`,
  )
  const refresh = () => { refetchChats(); refetchMsgs() }

  return (
    <div className="flex h-[calc(100vh-120px)]">
      {/* Chat sidebar */}
      <div className="w-80 border-r border-[var(--border)] overflow-y-auto bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">Chats</span>
          <Btn variant="ghost" onClick={refresh} className="px-2 py-1 text-xs">Refresh</Btn>
        </div>
        {chatsLoading ? <p className="p-4 text-[var(--text-tertiary)]">Loading...</p> : (chats ?? []).map(chat => (
          <button key={chat.id} onClick={() => setSelectedChat(chat.id)}
            className={`w-full text-left px-4 py-3 border-b border-[var(--border-light)] transition-all ${selectedChat === chat.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg-surface-hover)]'}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm text-[var(--text-primary)] truncate">{chat.name || chat.id}</span>
              <Badge variant={chat.isGroup ? 'secondary' : 'default'}>{chat.isGroup ? 'Group' : 'DM'}</Badge>
            </div>
          </button>
        ))}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg-base)]">
        {msgsLoading ? <p className="text-[var(--text-tertiary)]">Loading messages...</p>
          : (messages ?? []).length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-[var(--text-tertiary)] text-lg">Select a chat to view messages</p>
            </div>
          ) : (
            <div className="space-y-3 flex flex-col-reverse max-w-2xl mx-auto animate-fade">
              {(messages ?? []).map(msg => (
                <div key={msg.id} className={`max-w-md ${msg.isFromMe ? 'ml-auto' : ''}`}>
                  <Card glass={msg.isFromMe} className={`p-4 ${msg.isFromMe ? 'border-transparent' : ''}`}
                    style={msg.isFromMe ? { background: 'var(--accent-soft)' } : undefined}>
                    {!msg.isFromMe && <div className="font-semibold text-xs mb-1" style={{ color: 'var(--secondary)' }}>{msg.senderName}</div>}
                    <div className="text-sm text-[var(--text-primary)]">{msg.content || `[${msg.type}]`}</div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-2">{new Date(msg.timestamp).toLocaleTimeString()}</div>
                  </Card>
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
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [senderFilter, setSenderFilter] = useState<string>('')

  const params = new URLSearchParams()
  if (typeFilter) params.set('type', typeFilter)
  if (sourceFilter) params.set('source', sourceFilter)
  if (senderFilter) params.set('sender', senderFilter)
  params.set('limit', '100')

  const { data: media, loading, refetch } = useFetch<Message[]>(`${API}/media?${params}`)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title="Media">
        <Btn variant="ghost" onClick={refetch}>Refresh</Btn>
      </PageHeader>

      {/* Filters */}
      <Card className="p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-tertiary)]">Source</span>
            {['', 'chat', 'story'].map(s => (
              <button key={s} onClick={() => setSourceFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${sourceFilter === s ? 'bg-[var(--accent)] text-[var(--text-inverse)]' : 'bg-[var(--bg-inset)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]'}`}>
                {s || 'All'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-tertiary)]">Type</span>
            <button onClick={() => setTypeFilter('')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${!typeFilter ? 'bg-[var(--secondary)] text-[var(--text-inverse)]' : 'bg-[var(--bg-inset)] text-[var(--text-secondary)]'}`}>All</button>
            {MEDIA_TYPES.map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${typeFilter === t ? 'bg-[var(--secondary)] text-[var(--text-inverse)]' : 'bg-[var(--bg-inset)] text-[var(--text-secondary)]'}`}>{t}</button>
            ))}
          </div>

          <Input value={senderFilter} onChange={e => setSenderFilter(e.target.value)} placeholder="Search sender..." className="w-48 !py-1.5 text-xs" />
        </div>
      </Card>

      {loading ? <p className="text-[var(--text-tertiary)]">Loading media...</p>
        : (media ?? []).length === 0 ? <p className="text-[var(--text-tertiary)]">No media found.</p>
        : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-fade">
            {(media ?? []).map(m => (
              <Card key={m.id} glass className="p-4 hover:scale-[1.02] transition-all duration-200 cursor-default">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="secondary">{m.type}</Badge>
                  <Badge variant={m.chatId === 'status@broadcast' ? 'accent' : 'default'}>
                    {m.chatId === 'status@broadcast' ? 'Story' : 'Chat'}
                  </Badge>
                </div>
                <div className="text-sm text-[var(--text-primary)] truncate mt-1">{m.content || m.mimeType || m.type}</div>
                <div className="text-xs text-[var(--text-tertiary)] mt-2">{m.senderName} &middot; {new Date(m.timestamp).toLocaleDateString()}</div>
              </Card>
            ))}
          </div>
        )
      }
    </div>
  )
}

// ─── Apps Tab ────────────────────────────────────────────────────────────────

const EVENT_OPTIONS = ['message.received', 'media.received', 'message.sent', 'chat.updated']
const PERMISSION_OPTIONS = ['messages.read', 'chats.read', 'media.read', 'media.download', 'messages.send']

function AppEditForm({ app, onSave, onCancel }: { app: AppRecord; onSave: () => void; onCancel: () => void }) {
  const [webhookUrl, setWebhookUrl] = useState(app.webhookGlobalUrl)
  const [events, setEvents] = useState<string[]>(app.webhookEvents.map(e => e.name))
  const [permissions, setPermissions] = useState<string[]>(app.permissions)
  const [scopeTypes, setScopeTypes] = useState<string[]>(app.scopeChatTypes)
  const [saving, setSaving] = useState(false)

  const toggle = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item])
  }

  const save = async () => {
    setSaving(true)
    await fetch(`${API}/apps/${app.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ webhookGlobalUrl: webhookUrl, webhookEvents: events.map(e => ({ name: e })), permissions, scopeChatTypes: scopeTypes }) })
    setSaving(false); onSave()
  }

  return (
    <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-4">
      <Input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="Webhook URL" />
      <div><p className="text-xs font-medium text-[var(--text-tertiary)] mb-2">Events</p><ChipSelect options={EVENT_OPTIONS} selected={events} onToggle={v => toggle(events, v, setEvents)} /></div>
      <div><p className="text-xs font-medium text-[var(--text-tertiary)] mb-2">Permissions</p><ChipSelect options={PERMISSION_OPTIONS} selected={permissions} onToggle={v => toggle(permissions, v, setPermissions)} color="secondary" /></div>
      <div><p className="text-xs font-medium text-[var(--text-tertiary)] mb-2">Scope</p><ChipSelect options={['dm', 'group']} selected={scopeTypes} onToggle={v => toggle(scopeTypes, v, setScopeTypes)} /></div>
      <div className="flex gap-2">
        <Btn onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Btn>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  )
}

function AppsTab() {
  const { data: apps, loading, refetch } = useFetch<AppRecord[]>(`${API}/apps`)
  const [showForm, setShowForm] = useState(false)
  const [created, setCreated] = useState<AppRecord | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const [permissions, setPermissions] = useState<string[]>([])
  const [scopeTypes, setScopeTypes] = useState<string[]>(['dm', 'group'])

  const toggle = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item])
  }

  const createApp = async () => {
    try {
      const res = await fetch(`${API}/apps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ name, description, webhookGlobalUrl: webhookUrl || undefined, webhookEvents: events.length ? events.map(e => ({ name: e })) : undefined, permissions, scopeChatTypes: scopeTypes, scopeSpecificChats: [] }) })
      if (res.ok) { const app = await res.json(); setCreated(app); setShowForm(false); setName(''); setDescription(''); setWebhookUrl(''); setEvents([]); setPermissions([]); refetch() }
    } catch (err) { console.error('Failed to create app:', err) }
  }

  const deactivate = async (id: string) => { await fetch(`${API}/apps/${id}`, { method: 'DELETE', credentials: 'include' }); refetch() }

  if (loading) return <p className="p-6 text-[var(--text-tertiary)]">Loading apps...</p>

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <PageHeader title="Registered Apps">
        <Btn variant="ghost" onClick={refetch}>Refresh</Btn>
        <Btn onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ Register App'}</Btn>
      </PageHeader>

      {/* Created secrets banner */}
      {created && (
        <Card className="mb-6 p-5 border-[var(--accent)] bg-[var(--accent-soft)]">
          <p className="font-semibold text-sm text-[var(--text-primary)] mb-1">App created: {created.name}</p>
          <p className="text-xs text-[var(--text-secondary)] mb-3">Save these — they won't be shown again:</p>
          <div className="space-y-2">
            {[{ label: 'API Key', value: created.apiKey }, { label: 'Webhook Secret', value: created.webhookSecret }].map(({ label, value }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-tertiary)] w-24">{label}</span>
                <code className="text-xs font-mono bg-[var(--bg-surface)] px-3 py-1.5 rounded-[var(--radius-sm)] flex-1 break-all border border-[var(--border)]">{value}</code>
                <Btn variant="ghost" onClick={() => navigator.clipboard.writeText(value)} className="text-xs px-2">Copy</Btn>
              </div>
            ))}
          </div>
          <button onClick={() => setCreated(null)} className="mt-3 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Dismiss</button>
        </Card>
      )}

      {/* Registration form */}
      {showForm && (
        <Card className="mb-6 p-5 space-y-4">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="App name" />
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" />
          <Input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="Webhook URL (optional — leave empty for API-only)" />
          <div><p className="text-xs font-medium text-[var(--text-tertiary)] mb-2">Events (optional)</p><ChipSelect options={EVENT_OPTIONS} selected={events} onToggle={v => toggle(events, v, setEvents)} /></div>
          <div><p className="text-xs font-medium text-[var(--text-tertiary)] mb-2">Permissions</p><ChipSelect options={PERMISSION_OPTIONS} selected={permissions} onToggle={v => toggle(permissions, v, setPermissions)} color="secondary" /></div>
          <div><p className="text-xs font-medium text-[var(--text-tertiary)] mb-2">Scope</p><ChipSelect options={['dm', 'group']} selected={scopeTypes} onToggle={v => toggle(scopeTypes, v, setScopeTypes)} /></div>
          <Btn onClick={createApp} disabled={!name || (events.length > 0 && !webhookUrl)} className="w-full py-3">Register App</Btn>
        </Card>
      )}

      {/* App list */}
      {(apps ?? []).length === 0 ? <p className="text-[var(--text-tertiary)]">No apps registered yet.</p> : (
        <div className="space-y-4">{(apps ?? []).map(app => (
          <Card key={app.id} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-[var(--text-primary)]">{app.name}</div>
                {app.description && <div className="text-xs text-[var(--text-tertiary)] mt-0.5">{app.description}</div>}
              </div>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => setEditingId(editingId === app.id ? null : app.id)} className="text-xs px-2">
                  {editingId === app.id ? 'Close' : 'Edit'}
                </Btn>
                <Btn variant="ghost" onClick={() => deactivate(app.id)} className="text-xs px-2" style={{ color: 'var(--error)' }}>Deactivate</Btn>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {app.webhookEvents.map((e: { name: string; url?: string }) => <Badge key={e.name} variant="accent">{e.name}</Badge>)}
              {app.permissions.map(p => <Badge key={p} variant="secondary">{p}</Badge>)}
            </div>
            <div className="mt-2 text-xs text-[var(--text-tertiary)]">
              Key: <code className="font-mono">{app.apiKey}</code> &middot; Scope: {app.scopeChatTypes.join(', ')}
            </div>
            {editingId === app.id && <AppEditForm app={app} onSave={() => { setEditingId(null); refetch() }} onCancel={() => setEditingId(null)} />}
          </Card>
        ))}</div>
      )}
    </div>
  )
}

// ─── Logs Tab ────────────────────────────────────────────────────────────────

function LogsTab() {
  const { data: deliveries, loading, refetch } = useFetch<Delivery[]>(`${API}/deliveries?limit=200`)
  const { data: apps } = useFetch<AppRecord[]>(`${API}/apps`)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => { const i = setInterval(refetch, 30000); return () => clearInterval(i) }, [refetch])

  const appName = useCallback((id: string) => apps?.find(a => a.id === id)?.name ?? id, [apps])
  const formatPayload = (raw: string) => { try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw } }
  const statusBadge = (s: string) => s === 'delivered' ? 'success' as const : s === 'failed' ? 'error' as const : 'accent' as const

  if (loading) return <p className="p-6 text-[var(--text-tertiary)]">Loading delivery logs...</p>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title="Webhook Delivery Logs">
        <Btn variant="ghost" onClick={refetch}>Refresh</Btn>
      </PageHeader>

      {(deliveries ?? []).length === 0 ? <p className="text-[var(--text-tertiary)]">No deliveries yet.</p> : (
        <Card glass className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-tertiary)] bg-[var(--bg-inset)]">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">App</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Attempts</th>
                <th className="px-4 py-3">Response</th>
              </tr>
            </thead>
            <tbody>
              {(deliveries ?? []).map(d => (<>
                <tr key={d.id} className="border-t border-[var(--border-light)] cursor-pointer hover:bg-[var(--bg-surface-hover)] transition-colors"
                  onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>
                  <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{new Date(d.created_at * 1000).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs font-medium text-[var(--text-primary)]">{appName(d.app_id)}</td>
                  <td className="px-4 py-3"><code className="text-xs font-mono text-[var(--text-secondary)]">{d.event}</code></td>
                  <td className="px-4 py-3"><Badge variant={statusBadge(d.status)}>{d.status}</Badge></td>
                  <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{d.attempts}</td>
                  <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{d.response_status || '-'}</td>
                </tr>
                {expandedId === d.id && d.payload && (
                  <tr key={`${d.id}-payload`} className="border-t border-[var(--border-light)]">
                    <td colSpan={6} className="p-4">
                      <pre className="text-xs font-mono bg-[var(--bg-inset)] rounded-[var(--radius-md)] p-4 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap text-[var(--text-secondary)]">{formatPayload(d.payload)}</pre>
                    </td>
                  </tr>
                )}
              </>))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

// ─── Stats Bar ───────────────────────────────────────────────────────────────

function StatsBar() {
  const [tick, setTick] = useState(0)
  const { data: stats } = useFetch<Stats>(`${API}/stats?_t=${tick}`)
  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 5000); return () => clearInterval(i) }, [])

  if (!stats) return null
  const items = [
    { label: 'Messages', value: stats.messages, accent: false },
    { label: 'Chats', value: stats.chats, accent: false },
    { label: 'Media', value: stats.media, accent: false },
    { label: 'Apps', value: stats.apps, accent: true },
    { label: 'Deliveries', value: stats.deliveries, accent: true },
  ]
  return (
    <div className="flex items-center gap-1 px-6 py-2.5 border-b border-[var(--border)]" style={{ background: 'var(--glass-bg)', backdropFilter: `blur(var(--glass-blur))` }}>
      {items.map(i => (
        <div key={i.label} className={`flex items-center gap-2 px-3 py-1 rounded-full ${i.accent ? 'bg-[var(--accent-soft)]' : ''}`}>
          <span className={`text-sm font-bold ${i.accent ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{i.value.toLocaleString()}</span>
          <span className="text-xs text-[var(--text-tertiary)]">{i.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'messages', label: 'Messages' },
  { id: 'media', label: 'Media' },
  { id: 'apps', label: 'Apps' },
  { id: 'logs', label: 'Logs' },
]

export default function App() {
  const { dark, toggle } = useTheme()
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('messages')

  useEffect(() => {
    fetch(`${API}/auth/check`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setAuthenticated(d.authenticated))
      .catch(() => setAuthenticated(false))
  }, [])

  if (authenticated === null) return <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center"><p className="text-[var(--text-tertiary)]">Loading...</p></div>
  if (!authenticated) return <LoginScreen onLogin={() => setAuthenticated(true)} />

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 h-16 border-b border-[var(--border)]" style={{ background: 'var(--glass-bg)', backdropFilter: `blur(var(--glass-blur))` }}>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[var(--radius-sm)] flex items-center justify-center" style={{ background: 'var(--gradient-accent)' }}>
              <span className="text-xs font-bold text-white">WA</span>
            </div>
            <span className="text-lg font-bold text-[var(--text-primary)]">Companion</span>
            <StatusDot connected={true} />
          </div>
          <div className="flex items-center bg-[var(--bg-inset)] rounded-[var(--radius-md)] p-1">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium transition-all ${tab === t.id ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={toggle} className="p-2 rounded-[var(--radius-sm)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition-colors">
          {dark ? '\u2600\ufe0f' : '\ud83c\udf19'}
        </button>
      </nav>
      <StatsBar />

      {/* Content */}
      {tab === 'messages' && <MessagesTab />}
      {tab === 'media' && <MediaTab />}
      {tab === 'apps' && <AppsTab />}
      {tab === 'logs' && <LogsTab />}
    </div>
  )
}
