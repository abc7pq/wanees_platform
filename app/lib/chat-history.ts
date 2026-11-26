// سياق سوالف منقّح وقصير المدى لكل جلسة زائر.
// حتى يتذكر وُنيس حديثه مع الزائر («ابي اسولف معه صدق agent»).
// في الذاكرة فقط (تضيع مع restart — مقبول لسياق سوالف)، TTL 30 دقيقة، آخر 8 أدوار.

export type ChatTurn = { role: "visitor" | "assistant"; text: string };

const MAX_TURNS = 8;
const TTL_MS = 30 * 60 * 1000;
const MAX_KEYS = 5000;

const store = new Map<string, { turns: ChatTurn[]; at: number }>();

function prune(now = Date.now()) {
  for (const [key, entry] of store) {
    if (now - entry.at > TTL_MS) store.delete(key);
  }
  while (store.size > MAX_KEYS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function getChatHistory(sessionId: string): ChatTurn[] {
  const entry = store.get(sessionId);
  if (!entry) return [];
  if (Date.now() - entry.at > TTL_MS) {
    store.delete(sessionId);
    return [];
  }
  return entry.turns;
}

export function rememberChatTurn(sessionId: string, visitorText: string, assistantText: string) {
  prune();
  const entry = store.get(sessionId) ?? { turns: [], at: 0 };
  const visitor = visitorText.trim().slice(0, 240);
  const assistant = assistantText.trim().slice(0, 240);
  if (!visitor && !assistant) return;
  entry.turns.push({ role: "visitor", text: visitor });
  entry.turns.push({ role: "assistant", text: assistant });
  if (entry.turns.length > MAX_TURNS * 2) entry.turns.splice(0, entry.turns.length - MAX_TURNS * 2);
  entry.at = Date.now();
  store.set(sessionId, entry);
}
