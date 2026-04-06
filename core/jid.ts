import { jidNormalizedUser } from '@whiskeysockets/baileys'

/**
 * Normalize a JID — strips device suffix, leaves groups/LID/status unchanged.
 * 919986273519:48@s.whatsapp.net → 919986273519@s.whatsapp.net
 */
export function normalizeJid(jid: string | undefined | null): string {
  if (!jid) return ''
  return jidNormalizedUser(jid)
}

export function isLid(jid: string): boolean {
  return jid.endsWith('@lid')
}

export function isGroup(jid: string): boolean {
  return jid.endsWith('@g.us')
}

/**
 * Identity cache — in-memory Map<alias_jid, canonical_jid>.
 * Loaded from DB on startup, updated when new mappings discovered.
 */
let identityCache: Map<string, string> = new Map()

export function loadIdentityCache(mappings: Map<string, string>) {
  identityCache = mappings
}

export function updateIdentityCache(aliasJid: string, canonicalJid: string) {
  identityCache.set(aliasJid, canonicalJid)
}

/**
 * Resolve any JID to its canonical form. O(1) via in-memory cache.
 * Device JID → stripped phone JID
 * LID (mapped) → phone JID
 * LID (unknown) → stays as LID
 * Bare phone → phone@s.whatsapp.net
 */
export function resolveCanonicalJid(jid: string | undefined | null): string {
  if (!jid) return ''

  // 1. Strip device suffix
  const normalized = normalizeJid(jid)
  if (!normalized) return ''

  // 2. Check cache
  const cached = identityCache.get(normalized)
  if (cached) return cached

  // 3. Bare phone → append suffix
  if (!normalized.includes('@')) return normalized + '@s.whatsapp.net'

  // 4. Return as-is (unknown LID or already canonical)
  return normalized
}
