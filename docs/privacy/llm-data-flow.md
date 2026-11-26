# What visitor data goes to OpenAI

This page lists every field WANEES sends to OpenAI, by code path, and the
visitor notice (AI9) that describes it. Use it to review the notice, to answer
a privacy question, or to check a change that touches a prompt.

- **Verified against:** `ab23da7` (`ui/responsive-pass`), read-only, 2026-11-25.
- **Field list source:** AI Engineer's AI9 review, re-checked line by line against the code.
- **Updated 2026-11-26:** voice gating corrected (there is no separate voice flag) and the optional visitor registration added. Line numbers below may have drifted; the function names are authoritative.
- **Owner:** update this page in the same PR as any change to `app/lib/llm.ts`,
  `app/lib/agent-persona.ts`, `app/lib/realtime-session.ts`,
  `app/lib/chat-history.ts` or `redactConversationText` in `app/lib/assistant.ts`.

## When nothing is sent

Without `OPENAI_API_KEY`, no request leaves the server. Text intent falls back
to keyword matching (`fallbackParse`), and replies use the engine's draft.

## Text chat

The model is `WANEES_OPENAI_MODEL` (default `gpt-6-luna`). Requests set
`store: false` (`app/lib/llm.ts:123`).

### Intent: `parseCommand` (`app/lib/llm.ts:58`)

| Field | Limit | Redacted |
|---|---|---|
| Visitor message | 500 characters | Yes, by `redactConversationText` before the call (`assistant.ts:544`) |
| Current time | — | Not personal |
| Candidate activities: ID and name only | 64 items; ID 120, name 160 characters | Not personal |
| Last assistant reply | 300 characters | Not visitor text |

### Reply: `composeReply` (`app/lib/llm.ts:192`)

| Field | Limit | Redacted |
|---|---|---|
| Visitor message | 500 characters | Yes (`assistant/route.ts:529`) |
| Visitor brief (see below) | 1,600 characters | Not applicable, built by the server |
| Engine facts | 4,000 characters | Not personal |
| Draft reply | 600 characters | Not visitor text |
| Last 8 turns | 240 characters each | Visitor turns are stored already redacted (`assistant/route.ts:550`) |

### Legacy: `explain()` (`app/lib/llm.ts:160`)

Sends up to 500 characters of the text it is given. Nothing outside tests
calls it, and P7 (`5a3d32a`) deletes it. Remove this section when P7 merges.

## Visitor brief

`buildVisitorBrief` (`app/lib/agent-persona.ts:95`) is sent with every text
reply and as the opening instructions of a voice call. It contains:

- Event name and the current time
- Party: size, whether there are children, the youngest child's age
- Interests and today's mood
- Group budget and the approximate amount already spent
- Time left in the visit and when it ends
- Walking preference
- Up to 6 activities already done
- The next 5 stops: time, name, zone, price, wait and walk

It contains no name, phone number or email. Anonymous visits (the default)
collect none. When an organizer turns on the optional visitor registration
(`WANEES_FEATURE_VISITOR_REGISTRATION`, off by default), WANEES stores the
visitor's name and SMS-verified phone in PostgreSQL, but `buildVisitorBrief`,
the text prompts and the voice instructions never include them: registered
names and phone numbers are not sent to the language model. The phone number
does go to the SMS provider (Twilio Verify) to deliver and check the code.

## Voice call

`createRealtimeClientSecret` (`app/lib/realtime-session.ts:70`) opens a
Realtime session with:

- The visitor brief as `instructions`
- **The visitor's raw audio**, streamed from the browser
- Transcription by `WANEES_OPENAI_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`)

There is **no redaction** on this path: OpenAI receives the audio and creates
the transcript. The request doesn't set `store`, so retention follows the
Realtime API's terms, not the text path's `store: false`.

Voice is available whenever `OPENAI_API_KEY` is set and
`WANEES_FEATURE_LLM_ADAPTER` is not turned off: `realtimeAvailable()` in
`app/lib/realtime-session.ts`, checked by
`app/app/api/v1/events/[eventSlug]/assistant/call/route.ts`. There is no
separate voice flag; to disable voice, unset the key or turn the LLM adapter
flag off (which also disables the model on the text path). The notice still
needs its own voice line (below).

WANEES servers never receive or store the raw audio; it travels from the
browser to OpenAI over WebRTC. Engine requests the voice model makes through
`ask_wanees_engine` go through the normal `/assistant` path, so the turns WANEES
stores are redacted and expire after 24 hours like text turns.

## What redaction covers today

`redactConversationText` (`app/lib/assistant.ts`) replaces:

- Email addresses → `[email]`
- Saudi mobile numbers written as `05XXXXXXXX`, `9665XXXXXXXX` or `+9665XXXXXXXX`, with no separators → `[phone]`

It does **not** catch names, numbers with spaces or dashes, other international
numbers, or numbers in Arabic digits (٠-٩). AI3 widens it. Until AI3 is merged
and tested, the notice can't say "we remove numbers".

## Visitor notice (AI9)

### Approved wording now

> نستخدم خدمة ذكاء اصطناعي من OpenAI لفهم رسائلك واقتراح مسارك. نرسل لها رسالتك وتفضيلات زيارتك ومسارك. لا نطلب اسمك أو رقمك، ولا تُستخدم رسائلك لتدريب النماذج.

### Clause added after AI3 merges

> …ونحذف الأرقام والإيميلات من الرسائل النصية قبل الإرسال…

### Voice line, needed whenever an OpenAI key is configured

Draft pending AI1 and the voice retention check. It has to say that the call's
audio goes to OpenAI as spoken, without removing anything.

### Why each claim holds

| Claim | Holds because | Condition |
|---|---|---|
| "رسالتك وتفضيلات زيارتك ومسارك" | Covers the message, the visitor brief and the plan above | Recheck when the brief gains a field |
| "لا نطلب اسمك أو رقمك" | No form or API field collects them in the default anonymous mode | Not "we never send them": a visitor can type them. Does **not** hold when the organizer enables visitor registration; that mode needs its own notice and consent text (versioned per visitor) |
| "لا تُستخدم لتدريب النماذج" | `store: false` on text; OpenAI's API terms don't train on API data by default | Recheck if the provider or terms change |
| "نحذف الأرقام والإيميلات" | Only true after AI3 | Do not publish before AI3 |

The notice is a draft until User answers the AI9 question.
