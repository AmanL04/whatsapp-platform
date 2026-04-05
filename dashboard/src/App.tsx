import { useState, useEffect } from 'react'

type Tab = 'messages' | 'tasks' | 'media' | 'summary'

interface Chat {
  id: string
  name: string
  isGroup: boolean
  lastMessageAt: string
  unreadCount: number
}

interface Message {
  id: string
  chatId: string
  senderName: string
  content: string
  type: string
  timestamp: string
  isFromMe: boolean
  isGroup: boolean
  groupName?: string
}

interface Task {
  id: number
  from_name: string
  content: string
  confidence: string
  score: number
  created_at: number
  done: number
  chat_id: string
}

interface Summary {
  id: number
  content: string
  created_at: number
}

const API = '/api'

function useFetch<T>(url: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    fetch(url)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, deps)
  return { data, loading }
}

function MessagesTab() {
  const { data: chats, loading: chatsLoading } = useFetch<Chat[]>(`${API}/chats`)
  const [selectedChat, setSelectedChat] = useState<string | null>(null)
  const { data: messages, loading: msgsLoading } = useFetch<Message[]>(
    selectedChat ? `${API}/messages?chatId=${selectedChat}&limit=100` : `${API}/messages?limit=100`,
    [selectedChat],
  )

  return (
    <div className="flex h-[calc(100vh-60px)]">
      {/* Chat list */}
      <div className="w-72 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
        <h3 className="p-3 font-semibold text-sm text-gray-500 uppercase">Chats</h3>
        {chatsLoading ? (
          <p className="p-3 text-gray-400">Loading...</p>
        ) : (
          (chats ?? []).map(chat => (
            <button
              key={chat.id}
              onClick={() => setSelectedChat(chat.id)}
              className={`w-full text-left p-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 ${
                selectedChat === chat.id ? 'bg-green-50 dark:bg-green-900/20' : ''
              }`}
            >
              <div className="font-medium text-sm truncate">{chat.name || chat.id}</div>
              <div className="text-xs text-gray-400">
                {chat.isGroup ? 'Group' : 'DM'}
                {chat.unreadCount > 0 && (
                  <span className="ml-2 bg-green-500 text-white px-1.5 rounded-full">{chat.unreadCount}</span>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {msgsLoading ? (
          <p className="text-gray-400">Loading messages...</p>
        ) : (messages ?? []).length === 0 ? (
          <p className="text-gray-400 text-center mt-20">No messages yet. Connect WhatsApp and start chatting.</p>
        ) : (
          <div className="space-y-2 flex flex-col-reverse">
            {(messages ?? []).map(msg => (
              <div
                key={msg.id}
                className={`max-w-lg p-3 rounded-lg text-sm ${
                  msg.isFromMe
                    ? 'ml-auto bg-green-100 dark:bg-green-900/30'
                    : 'bg-gray-100 dark:bg-gray-800'
                }`}
              >
                {!msg.isFromMe && (
                  <div className="font-semibold text-xs text-green-600 dark:text-green-400 mb-1">
                    {msg.senderName}
                  </div>
                )}
                <div>{msg.content || `[${msg.type}]`}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TasksTab() {
  const { data: tasks, loading } = useFetch<Task[]>(`${API}/tasks`)
  const [localTasks, setLocalTasks] = useState<Task[]>([])

  useEffect(() => {
    if (tasks) setLocalTasks(tasks)
  }, [tasks])

  const markDone = async (id: number) => {
    await fetch(`${API}/tasks/${id}/done`, { method: 'POST' })
    setLocalTasks(prev => prev.filter(t => t.id !== id))
  }

  if (loading) return <p className="p-6 text-gray-400">Loading tasks...</p>

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold mb-4">Detected Tasks</h2>
      {localTasks.length === 0 ? (
        <p className="text-gray-400">No open tasks detected yet.</p>
      ) : (
        <div className="space-y-3">
          {localTasks.map(task => (
            <div key={task.id} className="flex items-start gap-3 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <button
                onClick={() => markDone(task.id)}
                className="mt-0.5 w-5 h-5 rounded border-2 border-gray-300 hover:border-green-500 flex-shrink-0 hover:bg-green-50"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm">{task.content}</div>
                <div className="text-xs text-gray-400 mt-1">
                  From {task.from_name} &middot;{' '}
                  <span className={
                    task.confidence === 'high' ? 'text-red-500' :
                    task.confidence === 'medium' ? 'text-yellow-500' : 'text-gray-400'
                  }>
                    {task.confidence} confidence
                  </span>
                  {' '}&middot; {new Date(task.created_at * 1000).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MediaTab() {
  const { data: media, loading } = useFetch<any[]>(`${API}/media`)

  if (loading) return <p className="p-6 text-gray-400">Loading media...</p>

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold mb-4">Recent Media</h2>
      {(media ?? []).length === 0 ? (
        <p className="text-gray-400">No media received yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {(media ?? []).map((m: any) => (
            <div key={m.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="text-xs font-medium text-gray-500 uppercase">{m.type}</div>
              <div className="text-sm mt-1 truncate">{m.caption || m.mime_type}</div>
              <div className="text-xs text-gray-400 mt-1">
                {m.sender_name} &middot; {new Date(m.timestamp * 1000).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryTab() {
  const { data: summaries, loading } = useFetch<Summary[]>(`${API}/summaries`)

  if (loading) return <p className="p-6 text-gray-400">Loading summaries...</p>

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold mb-4">Daily Summaries</h2>
      {(summaries ?? []).length === 0 ? (
        <p className="text-gray-400">No summaries yet. They'll appear after the 9am daily run.</p>
      ) : (
        <div className="space-y-4">
          {(summaries ?? []).map(s => (
            <div key={s.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-400 mb-2">
                {new Date(s.created_at * 1000).toLocaleString()}
              </div>
              <div className="text-sm whitespace-pre-wrap">{s.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'messages', label: 'Messages' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'media', label: 'Media' },
  { id: 'summary', label: 'Summary' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('messages')

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Nav */}
      <nav className="flex items-center gap-1 px-4 h-[60px] bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-lg font-bold text-green-600 mr-6">WA Companion</h1>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              tab === t.id
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      {tab === 'messages' && <MessagesTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'media' && <MediaTab />}
      {tab === 'summary' && <SummaryTab />}
    </div>
  )
}
