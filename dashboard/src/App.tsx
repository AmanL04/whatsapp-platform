import { useState, useEffect, useCallback } from 'react'

type Tab = 'messages' | 'media' | 'apps' | 'logs'

const API = '/dashboard/api'
const AUTH = '/dashboard/auth'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Chat { id: string; name: string; isGroup: boolean; lastMessageAt: string; unreadCount: number }
interface Message { id: string; chatId: string; senderName: string; content: string; type: string; mimeType?: string; timestamp: string; isFromMe: boolean; isGroup: boolean; groupName?: string }
interface AppRecord { id: string; name: string; description: string; webhookGlobalUrl: string; webhookSecret: string; webhookEvents: { name: string; url?: string }[]; apiKey: string; permissions: string[]; scopeChatTypes: string[]; scopeSpecificChats: string[]; active: boolean; createdAt: string }
interface Delivery { id: string; app_id: string; event: string; payload: string; status: string; attempts: number; last_attempt_at: number; response_status: number; created_at: number }

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

// ─── Login Screen ────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [step, setStep] = useState<'send' | 'verify'>('send')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const sendOtp = async () => {
    setSending(true)
    setError('')
    try {
      const res = await fetch(`${AUTH}/send-otp`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (res.ok) setStep('verify')
      else setError(data.error)
    } catch { setError('Failed to connect to server') }
    setSending(false)
  }

  const verifyOtp = async () => {
    setError('')
    try {
      const res = await fetch(`${AUTH}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) onLogin()
      else setError(data.error)
    } catch { setError('Failed to verify') }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-lg w-80">
        <h1 className="text-xl font-bold text-green-600 mb-2">WA Companion</h1>
        <p className="text-sm text-gray-500 mb-6">Login via WhatsApp OTP</p>

        {step === 'send' ? (
          <button onClick={sendOtp} disabled={sending}
            className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">
            {sending ? 'Sending...' : 'Send OTP to WhatsApp'}
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Enter the 6-digit code sent to your WhatsApp</p>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="123456" maxLength={6}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-center text-lg tracking-widest bg-transparent"
              onKeyDown={e => e.key === 'Enter' && verifyOtp()} autoFocus />
            <button onClick={verifyOtp}
              className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700">Verify</button>
            <button onClick={() => { setStep('send'); setCode(''); setError('') }}
              className="w-full text-sm text-gray-400 hover:text-gray-600">Resend code</button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </div>
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
    <div className="flex h-[calc(100vh-60px)]">
      <div className="w-72 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
        <div className="flex items-center justify-between p-3">
          <h3 className="font-semibold text-sm text-gray-500 uppercase">Chats</h3>
          <button onClick={refresh} className="text-xs text-gray-400 hover:text-gray-600">Refresh</button>
        </div>
        {chatsLoading ? <p className="p-3 text-gray-400">Loading...</p> : (chats ?? []).map(chat => (
          <button key={chat.id} onClick={() => setSelectedChat(chat.id)}
            className={`w-full text-left p-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 ${selectedChat === chat.id ? 'bg-green-50 dark:bg-green-900/20' : ''}`}>
            <div className="font-medium text-sm truncate">{chat.name || chat.id}</div>
            <div className="text-xs text-gray-400">{chat.isGroup ? 'Group' : 'DM'}
              {chat.unreadCount > 0 && <span className="ml-2 bg-green-500 text-white px-1.5 rounded-full">{chat.unreadCount}</span>}
            </div>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {msgsLoading ? <p className="text-gray-400">Loading messages...</p>
          : (messages ?? []).length === 0 ? <p className="text-gray-400 text-center mt-20">No messages yet.</p>
          : <div className="space-y-2 flex flex-col-reverse">
              {(messages ?? []).map(msg => (
                <div key={msg.id} className={`max-w-lg p-3 rounded-lg text-sm ${msg.isFromMe ? 'ml-auto bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-800'}`}>
                  {!msg.isFromMe && <div className="font-semibold text-xs text-green-600 dark:text-green-400 mb-1">{msg.senderName}</div>}
                  <div>{msg.content || `[${msg.type}]`}</div>
                  <div className="text-xs text-gray-400 mt-1">{new Date(msg.timestamp).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
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
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Recent Media</h2>
        <button onClick={refetch} className="text-sm text-gray-400 hover:text-gray-600">Refresh</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Source:</span>
          {['', 'chat', 'story'].map(s => (
            <button key={s} onClick={() => setSourceFilter(s)}
              className={`px-2 py-1 rounded text-xs ${sourceFilter === s ? 'bg-green-100 dark:bg-green-900/30 text-green-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Type:</span>
          <button onClick={() => setTypeFilter('')}
            className={`px-2 py-1 rounded text-xs ${!typeFilter ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>All</button>
          {MEDIA_TYPES.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-2 py-1 rounded text-xs ${typeFilter === t ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>{t}</button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Sender:</span>
          <input value={senderFilter} onChange={e => setSenderFilter(e.target.value)} placeholder="Search sender..."
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-transparent w-36" />
        </div>
      </div>

      {loading ? <p className="text-gray-400">Loading media...</p>
        : (media ?? []).length === 0 ? <p className="text-gray-400">No media found.</p>
        : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {(media ?? []).map((m) => (
              <div key={m.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-gray-500 uppercase">{m.type}</div>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${m.chatId === 'status@broadcast' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                    {m.chatId === 'status@broadcast' ? 'Story' : 'Chat'}
                  </span>
                </div>
                <div className="text-sm mt-1 truncate">{m.content || m.mimeType || m.type}</div>
                <div className="text-xs text-gray-400 mt-1">{m.senderName} &middot; {new Date(m.timestamp).toLocaleDateString()}</div>
              </div>
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

  const toggleItem = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item])
  }

  const save = async () => {
    setSaving(true)
    await fetch(`${API}/apps/${app.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        webhookGlobalUrl: webhookUrl,
        webhookEvents: events.map(e => ({ name: e })),
        permissions,
        scopeChatTypes: scopeTypes,
      }),
    })
    setSaving(false)
    onSave()
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-3">
      <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="Webhook URL"
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent text-sm" />
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Events</p>
        <div className="flex flex-wrap gap-2">{EVENT_OPTIONS.map(e => (
          <button key={e} onClick={() => toggleItem(events, e, setEvents)}
            className={`px-2 py-1 rounded text-xs ${events.includes(e) ? 'bg-green-100 dark:bg-green-900/30 text-green-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>{e}</button>
        ))}</div>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Permissions</p>
        <div className="flex flex-wrap gap-2">{PERMISSION_OPTIONS.map(p => (
          <button key={p} onClick={() => toggleItem(permissions, p, setPermissions)}
            className={`px-2 py-1 rounded text-xs ${permissions.includes(p) ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>{p}</button>
        ))}</div>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Chat Scope</p>
        <div className="flex gap-2">{['dm', 'group'].map(t => (
          <button key={t} onClick={() => toggleItem(scopeTypes, t, setScopeTypes)}
            className={`px-2 py-1 rounded text-xs ${scopeTypes.includes(t) ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>{t}</button>
        ))}</div>
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
        <button onClick={onCancel} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg text-xs font-medium">Cancel</button>
      </div>
    </div>
  )
}

function AppsTab() {
  const { data: apps, loading, refetch } = useFetch<AppRecord[]>(`${API}/apps`)
  const [showForm, setShowForm] = useState(false)
  const [created, setCreated] = useState<AppRecord | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const [permissions, setPermissions] = useState<string[]>([])
  const [scopeTypes, setScopeTypes] = useState<string[]>(['dm', 'group'])

  const toggleItem = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item])
  }

  const createApp = async () => {
    try {
      const res = await fetch(`${API}/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name, description, webhookGlobalUrl: webhookUrl,
          webhookEvents: events.map(e => ({ name: e })),
          permissions, scopeChatTypes: scopeTypes, scopeSpecificChats: [],
        }),
      })
      if (res.ok) {
        const app = await res.json()
        setCreated(app)
        setShowForm(false)
        setName(''); setDescription(''); setWebhookUrl(''); setEvents([]); setPermissions([])
        refetch()
      }
    } catch (err) {
      console.error('Failed to create app:', err)
    }
  }

  const deactivate = async (id: string) => {
    await fetch(`${API}/apps/${id}`, { method: 'DELETE', credentials: 'include' })
    refetch()
  }

  if (loading) return <p className="p-6 text-gray-400">Loading apps...</p>

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Registered Apps</h2>
        <div className="flex gap-2">
          <button onClick={refetch} className="text-sm text-gray-400 hover:text-gray-600">Refresh</button>
          <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
            {showForm ? 'Cancel' : '+ Register App'}
          </button>
        </div>
      </div>

      {/* Created app secrets (shown once) */}
      {created && (
        <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg">
          <p className="font-semibold text-sm mb-2">App created: {created.name}</p>
          <p className="text-xs text-gray-500 mb-2">Save these — they won't be shown again:</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded flex-1 break-all">{created.apiKey}</span>
              <button onClick={() => navigator.clipboard.writeText(created.apiKey)} className="text-xs text-green-600 hover:underline">Copy Key</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded flex-1 break-all">{created.webhookSecret}</span>
              <button onClick={() => navigator.clipboard.writeText(created.webhookSecret)} className="text-xs text-green-600 hover:underline">Copy Secret</button>
            </div>
          </div>
          <button onClick={() => setCreated(null)} className="mt-2 text-xs text-gray-400 hover:text-gray-600">Dismiss</button>
        </div>
      )}

      {/* Registration form */}
      {showForm && (
        <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="App name" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent text-sm" />
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent text-sm" />
          <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="Webhook URL (optional — leave empty for API-only app)" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent text-sm" />

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Events (optional — select if using webhooks)</p>
            <div className="flex flex-wrap gap-2">{EVENT_OPTIONS.map(e => (
              <button key={e} onClick={() => toggleItem(events, e, setEvents)}
                className={`px-2 py-1 rounded text-xs ${events.includes(e) ? 'bg-green-100 dark:bg-green-900/30 text-green-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>{e}</button>
            ))}</div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Permissions</p>
            <div className="flex flex-wrap gap-2">{PERMISSION_OPTIONS.map(p => (
              <button key={p} onClick={() => toggleItem(permissions, p, setPermissions)}
                className={`px-2 py-1 rounded text-xs ${permissions.includes(p) ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>{p}</button>
            ))}</div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Chat Scope</p>
            <div className="flex gap-2">
              {['dm', 'group'].map(t => (
                <button key={t} onClick={() => toggleItem(scopeTypes, t, setScopeTypes)}
                  className={`px-2 py-1 rounded text-xs ${scopeTypes.includes(t) ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>{t}</button>
              ))}
            </div>
          </div>

          <button onClick={createApp} disabled={!name || (events.length > 0 && !webhookUrl)}
            className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">Register App</button>
        </div>
      )}

      {/* App list */}
      {(apps ?? []).length === 0 ? <p className="text-gray-400">No apps registered yet.</p> : (
        <div className="space-y-3">{(apps ?? []).map(app => (
          <div key={app.id} className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{app.name}</div>
                <div className="text-xs text-gray-400">{app.description}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditingId(editingId === app.id ? null : app.id)} className="text-xs text-blue-500 hover:underline">
                  {editingId === app.id ? 'Close' : 'Edit'}
                </button>
                <button onClick={() => deactivate(app.id)} className="text-xs text-red-500 hover:underline">Deactivate</button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {app.webhookEvents.map((e: { name: string; url?: string }) => (
                <span key={e.name} className="px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded text-xs">{e.name}</span>
              ))}
              {app.permissions.map(p => (
                <span key={p} className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded text-xs">{p}</span>
              ))}
            </div>
            <div className="mt-1 text-xs text-gray-400">
              Key: {app.apiKey} &middot; Scope: {app.scopeChatTypes.join(', ')}
            </div>
            {editingId === app.id && <AppEditForm app={app} onSave={() => { setEditingId(null); refetch() }} onCancel={() => setEditingId(null)} />}
          </div>
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

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(refetch, 30000)
    return () => clearInterval(interval)
  }, [refetch])

  const appName = useCallback((id: string) => apps?.find(a => a.id === id)?.name ?? id, [apps])

  const formatPayload = (raw: string) => {
    try { return JSON.stringify(JSON.parse(raw), null, 2) }
    catch { return raw }
  }

  if (loading) return <p className="p-6 text-gray-400">Loading delivery logs...</p>

  const statusColor = (s: string) => s === 'delivered' ? 'text-green-600' : s === 'failed' ? 'text-red-500' : 'text-yellow-500'

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Webhook Delivery Logs</h2>
        <button onClick={refetch} className="text-sm text-gray-400 hover:text-gray-600">Refresh</button>
      </div>
      {(deliveries ?? []).length === 0 ? <p className="text-gray-400">No deliveries yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">App</th>
                <th className="pb-2 pr-4">Event</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Attempts</th>
                <th className="pb-2">Response</th>
              </tr>
            </thead>
            <tbody>
              {(deliveries ?? []).map(d => (<>
                <tr key={d.id} className="border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>
                  <td className="py-2 pr-4 text-xs text-gray-400">{new Date(d.created_at * 1000).toLocaleString()}</td>
                  <td className="py-2 pr-4 text-xs">{appName(d.app_id)}</td>
                  <td className="py-2 pr-4 text-xs font-mono">{d.event}</td>
                  <td className={`py-2 pr-4 text-xs font-medium ${statusColor(d.status)}`}>{d.status}</td>
                  <td className="py-2 pr-4 text-xs">{d.attempts}</td>
                  <td className="py-2 text-xs">{d.response_status || '-'}</td>
                </tr>
                {expandedId === d.id && d.payload && (
                  <tr key={`${d.id}-payload`} className="border-b border-gray-100 dark:border-gray-800">
                    <td colSpan={6} className="p-3">
                      <pre className="text-xs bg-gray-100 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">{formatPayload(d.payload)}</pre>
                    </td>
                  </tr>
                )}
              </>))}
            </tbody>
          </table>
        </div>
      )}
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

interface Stats { messages: number; chats: number; media: number; apps: number; deliveries: number }

function StatsBar() {
  const [tick, setTick] = useState(0)
  const { data: stats } = useFetch<Stats>(`${API}/stats?_t=${tick}`)

  // Auto-refresh every 5s
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(interval)
  }, [])

  if (!stats) return null
  const s = stats
  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-100 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500">
      <span>{s.messages.toLocaleString()} messages</span>
      <span>{s.chats.toLocaleString()} chats</span>
      <span>{s.media.toLocaleString()} media</span>
      <span>{s.apps} apps</span>
      <span>{s.deliveries.toLocaleString()} deliveries</span>
    </div>
  )
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('messages')

  // Check session on mount
  useEffect(() => {
    fetch(`${API}/auth/check`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setAuthenticated(d.authenticated))
      .catch(() => setAuthenticated(false))
  }, [])

  if (authenticated === null) return <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>
  if (!authenticated) return <LoginScreen onLogin={() => setAuthenticated(true)} />

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <nav className="flex items-center gap-1 px-4 h-[60px] bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-lg font-bold text-green-600 mr-6">WA Companion</h1>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${tab === t.id ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            {t.label}
          </button>
        ))}
      </nav>
      <StatsBar />

      {tab === 'messages' && <MessagesTab />}
      {tab === 'media' && <MediaTab />}
      {tab === 'apps' && <AppsTab />}
      {tab === 'logs' && <LogsTab />}
    </div>
  )
}
