const baseUrl = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const adminUrl = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";
const adminToken = process.env.ADMIN_TOKEN ?? "";
const eventSlug = "boulevard-world-demo";
let cookie = "";

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return { response, body };
}

async function adminRequest(path, init = {}, expectedStatus = 200) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("origin", adminUrl);
  if (adminToken) headers.set("x-admin-token", adminToken);
  const response = await fetch(`${adminUrl}${path}`, { ...init, headers });
  const body = await response.json().catch(() => null);
  if (response.status !== expectedStatus) throw new Error(`${init.method ?? "GET"} admin ${path} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(body)}`);
  return { response, body };
}

for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    await request("/api/health");
    break;
  } catch (error) {
    if (attempt === 29) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
const visitorHealth = await request("/api/health");
if (visitorHealth.body?.service !== "wanees-visitor-web" || "database" in visitorHealth.body) throw new Error("visitor health endpoint is not sanitized");

for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    const response = await fetch(`${adminUrl}/api/health`);
    if (response.ok) break;
    throw new Error(`admin health returned ${response.status}`);
  } catch (error) {
    if (attempt === 29) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
const adminHealthResponse = await fetch(`${adminUrl}/api/health`);
const adminHealthBody = await adminHealthResponse.json();
if (adminHealthBody?.service !== "wanees-admin-web" || "database" in adminHealthBody) throw new Error("admin health endpoint is not sanitized");

const event = await request(`/api/events/${eventSlug}`);
if (event.body?.data?.eventSlug !== eventSlug) throw new Error("event endpoint did not return the requested event");
const secondEvent = await request("/api/events/sample-festival");
if (secondEvent.body?.data?.eventSlug !== "sample-festival" || secondEvent.body?.data?.catalog?.zones?.[0]?.id !== "sample-zone") {
  throw new Error("second event catalog was not loaded independently");
}

const session = await request(`/api/v1/events/${eventSlug}/session`, {
  method: "POST",
  body: JSON.stringify({ clientType: "web", locale: "ar-SA", entryPoint: "http-smoke", preferences: { mood: "هادئ", interests: ["طعام"], availableMinutes: 120, startPointId: "main-entrance" } }),
});
if (session.response.status !== 201 || !cookie.includes("wanees_visitor_session")) throw new Error("web session did not set the HttpOnly visitor cookie");
if (session.body?.data?.token) throw new Error("web session leaked a bearer token in the response");
if (session.body?.data?.personalized || session.response.headers.getSetCookie().some((value) => value.startsWith("wanees_guest"))) throw new Error("ordinary visit persisted preferences without consent");

const itinerary = await request(`/api/v1/events/${eventSlug}/itinerary`, {
  method: "POST",
  body: JSON.stringify({ generatedReason: "http-smoke" }),
});
if (!itinerary.body?.data?.itineraryId || !itinerary.body?.data?.itinerary) throw new Error("itinerary was not created");

const restored = await request(`/api/v1/events/${eventSlug}/session`);
if (restored.body?.data?.sessionId !== session.body?.data?.sessionId) throw new Error("cookie session could not be restored");

const assistant = await request(`/api/v1/events/${eventSlug}/assistant`, { method: "POST", body: JSON.stringify({ message: "وين دورة المياه؟" }) });
if (!assistant.body?.data?.intent || !Array.isArray(assistant.body?.data?.sources)) throw new Error("assistant response is not grounded and typed");

const ambiguousSwap = await request(`/api/v1/events/${eventSlug}/assistant`, {
  method: "POST", body: JSON.stringify({ message: "بدّلها بشي أهدى" }),
});
if (ambiguousSwap.body.data.intent !== "swap" || !ambiguousSwap.body.data.needsClarification || ambiguousSwap.body.data.proposal) {
  throw new Error("an ambiguous stop change must ask for clarification before preparing a proposal");
}
const clarifiedSwap = await request(`/api/v1/events/${eventSlug}/assistant`, {
  method: "POST", body: JSON.stringify({ message: "الأولى" }),
});
if (clarifiedSwap.body.data.intent !== "swap" || clarifiedSwap.body.data.needsClarification
  || clarifiedSwap.body.data.proposal?.baseItineraryId !== itinerary.body.data.itineraryId
  || clarifiedSwap.body.data.itineraryId !== itinerary.body.data.itineraryId) {
  throw new Error("a reply to stop clarification must prepare a proposal for the current itinerary");
}

const assistantChange = await request(`/api/v1/events/${eventSlug}/assistant`, { method: "POST", body: JSON.stringify({ message: "تعبت، قلّل الجولة" }) });
const assistantProposal = assistantChange.body?.data?.proposal;
if (!assistantProposal?.id || !assistantProposal?.candidate || assistantChange.body?.data?.itinerary !== null) {
  throw new Error("assistant itinerary change was not returned as a proposal");
}
const activeBeforeDecision = await request(`/api/v1/events/${eventSlug}/itinerary`);
if (activeBeforeDecision.body?.data?.itineraryId !== itinerary.body.data.itineraryId || activeBeforeDecision.body?.data?.itinerary?.stops?.length !== itinerary.body.data.itinerary.stops.length) {
  throw new Error("assistant proposal changed the active itinerary before visitor consent");
}
const dismissedAssistantProposal = await request(`/api/v1/events/${eventSlug}/itinerary/replan`, {
  method: "POST",
  body: JSON.stringify({
    decision: "keep_current",
    proposalId: assistantProposal.id,
    baseItineraryId: assistantProposal.baseItineraryId,
    baseLiveRevision: assistantProposal.baseLiveRevision,
    reason: "http_smoke_kept_current",
  }),
});
if (dismissedAssistantProposal.body?.data?.mode !== "DISMISSED" || dismissedAssistantProposal.body?.data?.itineraryId !== itinerary.body.data.itineraryId) {
  throw new Error("assistant proposal dismissal did not preserve the active itinerary");
}

const live = await request(`/api/v1/events/${eventSlug}/live`);
if (!live.body?.data?.revision || !live.body?.data?.clock) throw new Error("live response did not include a revision and clock");

const replan = await request(`/api/v1/events/${eventSlug}/itinerary/replan`, { method: "POST", body: JSON.stringify({ decision: "preview", baseItineraryId: itinerary.body.data.itineraryId, baseLiveRevision: live.body.data.revision }) });
if (!replan.body?.data?.mode) throw new Error("replan response did not include a mode");

const pendingAssistantChange = await request(`/api/v1/events/${eventSlug}/assistant`, { method: "POST", body: JSON.stringify({ message: "تعبت، قلّل الجولة" }) });
const pendingProposal = pendingAssistantChange.body?.data?.proposal;
if (!pendingProposal?.id) throw new Error("expected a pending assistant proposal before the operator update");

const unauthorizedUpdates = await fetch(`${adminUrl}/api/v1/events/${eventSlug}/updates?view=active`);
if (unauthorizedUpdates.status !== 401) throw new Error(`unauthenticated admin update listing returned ${unauthorizedUpdates.status}, expected 401`);
const closedActivity = itinerary.body.data.itinerary.stops[0];
if (!closedActivity) throw new Error("initial itinerary has no activity to test update revocation");
const closure = await adminRequest(`/api/v1/events/${eventSlug}/updates`, {
  method: "POST",
  body: JSON.stringify({ updateType: "CLOSURE", targetType: "activity", targetId: closedActivity.act_id, payload: {}, endsAt: new Date(Date.now() + 60 * 60_000).toISOString() }),
}, 201);
const crowd = await adminRequest(`/api/v1/events/${eventSlug}/updates`, {
  method: "POST",
  body: JSON.stringify({ updateType: "CROWD_OVERRIDE", targetType: "zone", targetId: closedActivity.zone, payload: { level: 0.99 }, endsAt: new Date(Date.now() + 60 * 60_000).toISOString() }),
}, 201);
const activeUpdates = await adminRequest(`/api/v1/events/${eventSlug}/updates?view=active`);
if (activeUpdates.body?.meta?.contractVersion !== "v1" || activeUpdates.body.meta.requestId !== activeUpdates.response.headers.get("x-request-id")) {
  throw new Error("organizer v1 response is missing the shared contract metadata");
}
if (activeUpdates.body.data.length < 2) throw new Error("admin active update list is missing persisted updates");
const liveWithUpdates = await request(`/api/v1/events/${eventSlug}/live`);
const staleAcceptance = await fetch(`${baseUrl}/api/v1/events/${eventSlug}/itinerary/replan`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({
    decision: "accept",
    proposalId: pendingProposal.id,
    baseItineraryId: pendingProposal.baseItineraryId,
    baseLiveRevision: pendingProposal.baseLiveRevision,
  }),
});
if (staleAcceptance.status !== 409 || (await staleAcceptance.json()).error?.code !== "PROPOSAL_STALE") {
  throw new Error("an assistant proposal could be accepted after the live event revision changed");
}
if (!liveWithUpdates.body.data.updates.some((update) => update.id === closure.body.data.update.id)) throw new Error("visitor live endpoint did not expose the active closure");
if (!liveWithUpdates.body.data.crowd.some((snapshot) => snapshot.zone === closedActivity.zone && snapshot.level === 0.99)) {
  throw new Error(`visitor live endpoint did not expose the linked crowd snapshot for ${closedActivity.zone}: ${JSON.stringify(liveWithUpdates.body.data.crowd)}`);
}
const closureReplan = await request(`/api/v1/events/${eventSlug}/itinerary/replan`, {
  method: "POST",
  body: JSON.stringify({ decision: "preview", baseItineraryId: itinerary.body.data.itineraryId, baseLiveRevision: liveWithUpdates.body.data.revision }),
});
if (closureReplan.body.data.mode !== "APPLIED" || closureReplan.body.data.itinerary.stops.some((stop) => stop.act_id === closedActivity.act_id)) {
  throw new Error("urgent closure was not applied to the visitor itinerary");
}
await adminRequest(`/api/v1/events/sample-festival/updates/${closure.body.data.update.id}`, {
  method: "PATCH", body: JSON.stringify({ action: "revoke", reason: "اختبار عزل الفعالية" }),
}, 404);
const revokedClosure = await adminRequest(`/api/v1/events/${eventSlug}/updates/${closure.body.data.update.id}`, {
  method: "PATCH", body: JSON.stringify({ action: "revoke", reason: "تصحيح اختبار التكامل" }),
});
if (revokedClosure.body.data.status !== "REVOKED") throw new Error("operator update was not revoked");
await adminRequest(`/api/v1/events/${eventSlug}/updates/${closure.body.data.update.id}`, {
  method: "PATCH", body: JSON.stringify({ action: "revoke", reason: "تكرار آمن" }),
});
await adminRequest(`/api/v1/events/${eventSlug}/updates/${crowd.body.data.update.id}`, {
  method: "PATCH", body: JSON.stringify({ action: "revoke" }),
});
const history = await adminRequest(`/api/v1/events/${eventSlug}/updates?view=history`);
const historyClosure = history.body.data.find((update) => update.id === closure.body.data.update.id);
if (historyClosure?.status !== "REVOKED" || historyClosure.revocationReason !== "تصحيح اختبار التكامل") throw new Error("revocation history or reason was not retained");
const liveAfterRevoke = await request(`/api/v1/events/${eventSlug}/live`);
if (liveAfterRevoke.body.data.updates.some((update) => update.id === closure.body.data.update.id || update.id === crowd.body.data.update.id)) throw new Error("revoked updates remain visible in visitor live state");
if (liveAfterRevoke.body.data.crowd.some((snapshot) => snapshot.zone === closedActivity.zone && snapshot.level === 0.99)) throw new Error("crowd snapshot linked to a revoked update remains visible");
const afterRevokeReplan = await request(`/api/v1/events/${eventSlug}/itinerary/replan`, {
  method: "POST",
  body: JSON.stringify({ decision: "preview", baseItineraryId: closureReplan.body.data.itineraryId, baseLiveRevision: liveAfterRevoke.body.data.revision }),
});
if (afterRevokeReplan.body.data.live?.eventUpdateIds?.includes(closure.body.data.update.id)) throw new Error("replan still consumed a revoked update");

const freshAssistantChange = await request(`/api/v1/events/${eventSlug}/assistant`, { method: "POST", body: JSON.stringify({ message: "تعبت، قلّل الجولة" }) });
const freshProposal = freshAssistantChange.body?.data?.proposal;
if (!freshProposal?.id) throw new Error("expected a new assistant proposal after revocation");
const acceptedAssistant = await request(`/api/v1/events/${eventSlug}/itinerary/replan`, {
  method: "POST",
  body: JSON.stringify({
    decision: "accept",
    proposalId: freshProposal.id,
    baseItineraryId: freshProposal.baseItineraryId,
    baseLiveRevision: freshProposal.baseLiveRevision,
  }),
});
const activeAfterAcceptance = await request(`/api/v1/events/${eventSlug}/itinerary`);
if (acceptedAssistant.body.data.mode !== "APPLIED" || activeAfterAcceptance.body.data.itineraryId !== freshProposal.id) {
  throw new Error("assistant proposal acceptance did not activate the chosen itinerary");
}

// ملف الضيف: الكوكي تُناسب من Set-Cookie منفصلة عن كوكي الجلسة
const optIn = await fetch(`${baseUrl}/api/v1/events/${eventSlug}/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ clientType: "web", locale: "ar-SA", entryPoint: "http-smoke-opt-in", preferences: { mood: "هادئ", optInPersist: true } }),
});
if (optIn.status !== 201) throw new Error("explicit opt-in session could not be created");
const sessionSetCookies = optIn.headers.getSetCookie();
const optedInVisitorCookie = sessionSetCookies.find((value) => value.startsWith("wanees_visitor_session="))?.split(";")[0];
const guestCookieRaw = sessionSetCookies.find((value) => value.startsWith("wanees_guest="));
if (!guestCookieRaw) throw new Error("session create did not set the wanees_guest cookie");
const guestCookie = guestCookieRaw.split(";")[0];
const guestRequest = async (path, init = {}, expectedStatus = 200) => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("cookie", guestCookie);
  const guestResponse = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const guestBody = await guestResponse.json().catch(() => null);
  if (guestResponse.status !== expectedStatus) throw new Error(`${init.method ?? "GET"} ${path} returned ${guestResponse.status}, expected ${expectedStatus}: ${JSON.stringify(guestBody)}`);
  return { response: guestResponse, body: guestBody };
};
const guestInitial = await guestRequest("/api/v1/guest");
if (guestInitial.body.data.exists !== true || !guestInitial.body.data.preferences?.mood) throw new Error("guest profile did not persist quiz preferences");
// Guest profiles are scoped to the event's organization.
const guestScoped = await guestRequest(`/api/v1/guest?eventSlug=${encodeURIComponent(eventSlug)}`);
if (guestScoped.body.data.exists !== true) throw new Error("guest profile was not found in its event's organization");
await guestRequest("/api/v1/guest?eventSlug=NOT%20A%20SLUG", {}, 400);
await guestRequest("/api/v1/guest", { method: "POST" }, 400);
const guestPatched = await guestRequest("/api/v1/guest", { method: "PATCH", body: JSON.stringify({ displayName: "صديق ونيس" }) });
if (guestPatched.body.data.updated !== true) throw new Error("guest displayName update failed");
const guestReloaded = await guestRequest("/api/v1/guest");
if (guestReloaded.body.data.displayName !== "صديق ونيس") throw new Error("guest displayName was not retained");
const guestDeleted = await guestRequest("/api/v1/guest", { method: "DELETE" });
if (guestDeleted.body.data.deleted !== true) throw new Error("guest delete-my-data failed");
const deleteCookie = guestDeleted.response.headers.getSetCookie().find((value) => value.startsWith("wanees_guest=")) ?? "";
if (!deleteCookie.includes("Max-Age=0")) throw new Error("guest cookie was not cleared on delete");
const guestAfterDelete = await guestRequest("/api/v1/guest");
if (guestAfterDelete.body.data.exists !== false) throw new Error("guest profile still exists after delete-my-data");
if (optedInVisitorCookie) await fetch(`${baseUrl}/api/v1/events/${eventSlug}/session`, { method: "DELETE", headers: { cookie: optedInVisitorCookie } });

// A returning guest (audit 4.1/4.2): «تذكّرني» mid-visit, then a new visit on the same browser is
// counted, greeted as returning and does not repeat last time's activities.
const raw = async (path, cookies, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", cookie: cookies.filter(Boolean).join("; "), ...(init.headers ?? {}) } });
  return { response, body: await response.json().catch(() => null) };
};
const sessionCookieOf = (response, name) => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0] ?? "";
const firstVisit = await raw(`/api/v1/events/${eventSlug}/session`, [], { method: "POST", body: JSON.stringify({ clientType: "web", locale: "ar-SA", entryPoint: "http-smoke-returning", preferences: { interests: ["طعام"], availableMinutes: 180 } }) });
const firstVisitCookie = sessionCookieOf(firstVisit.response, "wanees_visitor_session");
if (firstVisit.response.status !== 201 || firstVisit.body?.data?.remembered !== false || !firstVisitCookie) throw new Error("a first visit must start unremembered");
const firstPlan = await raw(`/api/v1/events/${eventSlug}/itinerary`, [firstVisitCookie], { method: "POST", body: JSON.stringify({ generatedReason: "http-smoke" }) });
const firstKeys = firstPlan.body?.data?.itinerary?.stops?.map((stop) => stop.act_id) ?? [];
if (!firstPlan.response.ok || firstKeys.length === 0) throw new Error("the first visit's plan was not built");
const rememberOn = await raw(`/api/v1/events/${eventSlug}/session`, [firstVisitCookie], { method: "PATCH", body: JSON.stringify({ rememberMe: true }) });
const rememberedGuestCookie = sessionCookieOf(rememberOn.response, "wanees_guest");
if (rememberOn.response.status !== 200 || rememberOn.body?.data?.remembered !== true || !rememberedGuestCookie) throw new Error("«تذكّرني» did not remember the guest");
const firstRead = await raw(`/api/v1/events/${eventSlug}/session`, [firstVisitCookie]);
if (firstRead.body?.data?.remembered !== true || firstRead.body.data.visitCount !== 1) throw new Error("the session must say it is remembered, as visit 1");
const secondVisit = await raw(`/api/v1/events/${eventSlug}/session`, [rememberedGuestCookie], { method: "POST", body: JSON.stringify({ clientType: "web", locale: "ar-SA", entryPoint: "http-smoke-returning", preferences: { interests: ["طعام"], availableMinutes: 180 } }) });
const secondVisitCookie = sessionCookieOf(secondVisit.response, "wanees_visitor_session");
if (secondVisit.response.status !== 201 || secondVisit.body?.data?.personalized !== true || secondVisit.body.data.visitCount !== 2) throw new Error("a remembered guest's new visit must be personalized as visit 2");
const secondPlan = await raw(`/api/v1/events/${eventSlug}/itinerary`, [secondVisitCookie], { method: "POST", body: JSON.stringify({ generatedReason: "http-smoke" }) });
const secondKeys = secondPlan.body?.data?.itinerary?.stops?.map((stop) => stop.act_id) ?? [];
if (secondKeys.length === 0 || secondKeys.some((key) => firstKeys.includes(key))) throw new Error(`a returning guest's plan repeated last visit: ${secondKeys.filter((key) => firstKeys.includes(key)).join(",")}`);
const guestAfterReturn = await raw(`/api/v1/guest?eventSlug=${eventSlug}`, [rememberedGuestCookie]);
if (guestAfterReturn.body?.data?.visitCount !== 2 || !guestAfterReturn.body.data.lastVisitAt) throw new Error("the guest profile must count both visits");
const rememberBad = await raw(`/api/v1/events/${eventSlug}/session`, [secondVisitCookie], { method: "PATCH", body: JSON.stringify({ rememberMe: "yes" }) });
if (rememberBad.response.status !== 400) throw new Error("rememberMe must be a boolean");
const rememberOff = await raw(`/api/v1/events/${eventSlug}/session`, [secondVisitCookie, rememberedGuestCookie], { method: "PATCH", body: JSON.stringify({ rememberMe: false }) });
const clearedGuest = rememberOff.response.headers.getSetCookie().find((value) => value.startsWith("wanees_guest=")) ?? "";
if (rememberOff.body?.data?.remembered !== false || !clearedGuest.includes("Max-Age=0")) throw new Error("unticking «تذكّرني» must clear the guest cookie");
const guestAfterForget = await raw(`/api/v1/guest?eventSlug=${eventSlug}`, [rememberedGuestCookie]);
if (guestAfterForget.body?.data?.exists !== false) throw new Error("unticking «تذكّرني» must delete the guest profile");
const secondAfterForget = await raw(`/api/v1/events/${eventSlug}/session`, [secondVisitCookie]);
if (secondAfterForget.response.status !== 200 || secondAfterForget.body?.data?.remembered !== false) throw new Error("the visit must go on, unremembered");
for (const visitCookie of [firstVisitCookie, secondVisitCookie]) await raw(`/api/v1/events/${eventSlug}/session`, [visitCookie], { method: "DELETE" });

// Phone ↔ screen link (audit 4.3): one use, read-only, ends on «انتهيت», on revoke, and only in its event.
const newVisit = async (slug, entryPoint) => {
  const created = await raw(`/api/v1/events/${slug}/session`, [], { method: "POST", body: JSON.stringify({ clientType: "web", locale: "ar-SA", entryPoint, preferences: { interests: [], availableMinutes: 120 } }) });
  if (created.response.status !== 201) throw new Error(`could not start a ${slug} visit: ${created.response.status}`);
  return sessionCookieOf(created.response, "wanees_visitor_session");
};
const linkPath = `/api/v1/events/${eventSlug}/link`;
const linkNoAuth = await fetch(`${baseUrl}${linkPath}`, { method: "POST" });
if (linkNoAuth.status !== 401) throw new Error("creating a link code needs the visitor's session");
const linkOwner = await request(linkPath, { method: "POST", body: "{}" });
const linkCode = linkOwner.body?.data?.code;
if (linkOwner.response.status !== 201 || !/^[2-9A-HJKMNP-Z]{6}$/.test(linkCode ?? "") || linkOwner.body.data.scope !== "read" || !String(linkOwner.body.data.qrSvg).startsWith("<svg")) throw new Error("the phone must get a 6-character read-only code with a QR");
if (Date.parse(linkOwner.body.data.expiresAt) - Date.now() > 10 * 60_000 + 5000) throw new Error("a link code must expire within 10 minutes");
const kioskCookie = await newVisit(eventSlug, "http-smoke-kiosk");
const otherScreenCookie = await newVisit(eventSlug, "http-smoke-kiosk-2");
const badCode = await raw(`${linkPath}/redeem`, [kioskCookie], { method: "POST", body: JSON.stringify({ code: "12" }) });
if (badCode.response.status !== 400) throw new Error("a malformed code must be a 400");
const ownRedeem = await raw(`${linkPath}/redeem`, [cookie], { method: "POST", body: JSON.stringify({ code: linkCode }) });
if (ownRedeem.response.status !== 404) throw new Error("a phone cannot redeem its own code");
const foreignCookie = await newVisit("sample-festival", "http-smoke-kiosk-foreign");
const foreignRedeem = await raw("/api/v1/events/sample-festival/link/redeem", [foreignCookie], { method: "POST", body: JSON.stringify({ code: linkCode }) });
if (foreignRedeem.response.status !== 404) throw new Error("a code must not work at another event");
const redeemed = await raw(`${linkPath}/redeem`, [kioskCookie], { method: "POST", body: JSON.stringify({ code: linkCode.toLowerCase().replace(/^(...)/, "$1 ") }) });
const grantId = redeemed.body?.data?.grantId;
if (redeemed.response.status !== 201 || !grantId || redeemed.body.data.scope !== "read" || redeemed.body.data.idleSeconds !== 60) throw new Error("the screen must redeem a typed code once");
const redeemedAgain = await raw(`${linkPath}/redeem`, [otherScreenCookie], { method: "POST", body: JSON.stringify({ code: linkCode }) });
if (redeemedAgain.response.status !== 404) throw new Error("a link code must work only once");
const linkStatus = await request(linkPath);
if (linkStatus.body?.data?.status !== "active") throw new Error("the phone must see that a screen is linked");
const kioskView = await raw(`${linkPath}/${grantId}`, [kioskCookie]);
const ownerPlan = await request(`/api/v1/events/${eventSlug}/itinerary`);
if (kioskView.response.status !== 200 || kioskView.body?.data?.scope !== "read" || kioskView.body.data.stops.length !== ownerPlan.body.data.itinerary.stops.length) throw new Error("the linked screen must show the visit's plan");
if (JSON.stringify(kioskView.body).match(/preferences|message|companions|sessionId/)) throw new Error("the linked screen must not see preferences, chat or ids");
const kioskWrite = await raw(`${linkPath}/${grantId}`, [kioskCookie], { method: "POST", body: "{}" });
if (kioskWrite.response.status !== 405) throw new Error("a read grant must refuse writes");
const strangerView = await raw(`${linkPath}/${grantId}`, [otherScreenCookie]);
if (strangerView.response.status !== 410) throw new Error("only the screen that redeemed the code may use it");
const kioskOwnPlan = await raw(`/api/v1/events/${eventSlug}/itinerary`, [kioskCookie]);
if (kioskOwnPlan.body?.data?.itineraryId === ownerPlan.body.data.itineraryId) throw new Error("the screen's own session must not become the visitor's");
const revoked = await request(linkPath, { method: "DELETE" });
if (!(revoked.body?.data?.revoked >= 1)) throw new Error("the phone must be able to stop the link");
const viewAfterRevoke = await raw(`${linkPath}/${grantId}`, [kioskCookie]);
if (viewAfterRevoke.response.status !== 410) throw new Error("a revoked link must end at once");
// «انتهيت» on the screen.
const secondCode = (await request(linkPath, { method: "POST", body: "{}" })).body.data.code;
const secondGrant = (await raw(`${linkPath}/redeem`, [kioskCookie], { method: "POST", body: JSON.stringify({ code: secondCode }) })).body?.data?.grantId;
const finished = await raw(`${linkPath}/${secondGrant}`, [kioskCookie], { method: "DELETE" });
const viewAfterFinish = await raw(`${linkPath}/${secondGrant}`, [kioskCookie]);
if (finished.body?.data?.ended !== true || viewAfterFinish.response.status !== 410) throw new Error("«انتهيت» must end the link");
// A new code makes the previous unused one stop working.
const staleCode = (await request(linkPath, { method: "POST", body: "{}" })).body.data.code;
await request(linkPath, { method: "POST", body: "{}" });
const staleRedeem = await raw(`${linkPath}/redeem`, [otherScreenCookie], { method: "POST", body: JSON.stringify({ code: staleCode }) });
if (staleRedeem.response.status !== 404) throw new Error("an earlier unused code must stop working when a new one is made");
await request(linkPath, { method: "DELETE" });
for (const visitCookie of [kioskCookie, otherScreenCookie]) await raw(`/api/v1/events/${eventSlug}/session`, [visitCookie], { method: "DELETE" });
await raw("/api/v1/events/sample-festival/session", [foreignCookie], { method: "DELETE" });

// اتجاهات المشي: 401 بدون جلسة، ومسار بخطوات مرقمة مع الجلسة، و404 لوجهة غير موجودة
const directionsNoAuth = await fetch(`${baseUrl}/api/v1/events/${eventSlug}/directions?to=x`);
if (directionsNoAuth.status !== 401) throw new Error("directions endpoint must require a visitor session");
const itineraryZones = [...new Set(itinerary.body.data.itinerary.stops.map((stop) => stop.zone))];
const directions = await request(`/api/v1/events/${eventSlug}/directions?to=${encodeURIComponent(itineraryZones.at(-1))}&from=${encodeURIComponent(itineraryZones[0])}`);
const dirData = directions.body.data;
if (!Array.isArray(dirData.steps) || dirData.steps.length === 0) throw new Error("directions returned no steps");
if (dirData.target?.zone !== itineraryZones.at(-1)) throw new Error("directions resolved the wrong target zone");
if (typeof dirData.totalWalkMin !== "number" || dirData.totalWalkMin < 0) throw new Error("directions totalWalkMin is invalid");
if (!Array.isArray(dirData.pathNodes) || dirData.pathNodes.length === 0) throw new Error("directions returned no path nodes for the map");
const serviceDirections = await request(`/api/v1/events/${eventSlug}/directions?to=service-restrooms-main&from=main-entrance`);
const serviceRoute = serviceDirections.body.data;
if (serviceRoute.mode !== "graph" || serviceRoute.arrival !== "destination_node" || typeof serviceRoute.demoRoute !== "boolean" ||
    serviceRoute.steps.at(0)?.id !== "main-entrance" || serviceRoute.steps.at(-1)?.id !== "service-restrooms-main") {
  throw new Error("directions did not follow the graph from the selected entrance to the exact service");
}
const directionChat = await request(`/api/v1/events/${eventSlug}/assistant`, {
  method: "POST", body: JSON.stringify({ message: "كيف أوصل إلى باتل كارت؟" }),
});
if (directionChat.body.data.intent !== "location" || directionChat.body.data.sources[0]?.id !== "battle_kart") {
  throw new Error("assistant did not resolve a named activity for directions");
}
const directionsMissing = await fetch(`${baseUrl}/api/v1/events/${eventSlug}/directions?to=not-a-real-zone`, { headers: { cookie } });
const directionsMissingBody = await directionsMissing.json().catch(() => null);
if (directionsMissing.status !== 404 || directionsMissingBody?.error?.code !== "TARGET_NOT_FOUND") throw new Error("directions missing target should 404 with TARGET_NOT_FOUND");

// Audit 3.1–3.2: where the visitor is. The phone sends only a walkway node; the server checks it is
// on this event's open graph and fresh before counting walking minutes from it.
const africaNode = (event.body?.data?.catalog?.routeGraph?.nodes ?? []).find((node) => node.status === "open" && node.zone === "africa");
if (!africaNode) throw new Error("the seeded walkway graph has no open node in Africa");
const positionQuery = (nodeId, capturedAt = new Date().toISOString()) => `nodeId=${encodeURIComponent(nodeId)}&source=gps&accuracyM=20&capturedAt=${encodeURIComponent(capturedAt)}`;
const nearbyNoSession = await fetch(`${baseUrl}/api/v1/events/${eventSlug}/nearby?category=toilets`);
if (nearbyNoSession.status !== 401) throw new Error("«حولي» must require a visitor session");
const nearbyBadCategory = await fetch(`${baseUrl}/api/v1/events/${eventSlug}/nearby?category=casino`, { headers: { cookie } });
if (nearbyBadCategory.status !== 400) throw new Error("«حولي» must refuse an unknown category");
const nearbyGps = await request(`/api/v1/events/${eventSlug}/nearby?category=toilets&${positionQuery(africaNode.id)}`);
const nearbyGpsData = nearbyGps.body?.data;
if (nearbyGps.response.status !== 200 || nearbyGpsData?.origin?.source !== "gps" || nearbyGpsData.results[0]?.zone !== "africa" || nearbyGpsData.results.length > 3) {
  throw new Error("standing in Africa, the Africa toilets must come first (at most three results)");
}
if (!nearbyGpsData.results.every((place) => typeof place.walkMin === "number" && place.sourceRef?.startsWith("catalog:"))) throw new Error("«حولي» results must carry walking minutes and a source");
const nearbyForeign = await request(`/api/v1/events/${eventSlug}/nearby?category=toilets&${positionQuery("node-from-another-event")}`);
if (nearbyForeign.body?.data?.positionRejected !== "unknown_node" || nearbyForeign.body.data.origin?.source === "gps") throw new Error("a node outside this event must be refused");
const nearbyStale = await request(`/api/v1/events/${eventSlug}/nearby?category=toilets&${positionQuery(africaNode.id, new Date(Date.now() - 10 * 60_000).toISOString())}`);
if (nearbyStale.body?.data?.positionRejected !== "stale") throw new Error("a ten-minute-old GPS fix must be refused as stale");
const nearbyBadPosition = await fetch(`${baseUrl}/api/v1/events/${eventSlug}/nearby?category=toilets&nodeId=x&source=gps&capturedAt=yesterday`, { headers: { cookie } });
if (nearbyBadPosition.status !== 400) throw new Error("a malformed position must be a 400");
const assistantAtPosition = await request(`/api/v1/events/${eventSlug}/assistant`, {
  method: "POST", body: JSON.stringify({ message: "وين أقرب دورة مياه؟", position: { nodeId: africaNode.id, source: "gps", accuracyM: 20, capturedAt: new Date().toISOString() } }),
});
if (assistantAtPosition.body?.data?.position?.zone !== "africa" || assistantAtPosition.body.data.position.source !== "gps") throw new Error("the assistant must count from the visitor's GPS position");
const assistantForeignPosition = await request(`/api/v1/events/${eventSlug}/assistant`, {
  method: "POST", body: JSON.stringify({ message: "وين أقرب دورة مياه؟", position: { nodeId: "node-from-another-event", source: "gps", capturedAt: new Date().toISOString() } }),
});
if (assistantForeignPosition.body?.data?.positionRejected !== "unknown_node" || assistantForeignPosition.body.data.position?.source === "gps") throw new Error("the assistant must refuse a foreign node");
// «أنا»: the reply language is a visit preference the visitor can change.
const languageEnglish = await request(`/api/v1/events/${eventSlug}/session`, { method: "PATCH", body: JSON.stringify({ replyLanguage: "en" }) });
const languageRead = await request(`/api/v1/events/${eventSlug}/session`);
if (languageEnglish.response.status !== 200 || languageRead.body?.data?.preferences?.replyLanguage !== "en") throw new Error("the reply language did not persist");
const languageBad = await fetch(`${baseUrl}/api/v1/events/${eventSlug}/session`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ replyLanguage: "xx" }) });
if (languageBad.status !== 400) throw new Error("an unknown reply language must be a 400");
await request(`/api/v1/events/${eventSlug}/session`, { method: "PATCH", body: JSON.stringify({ replyLanguage: "ar" }) });
// A spoken position («انا عند …») is remembered for 20 minutes and used by «حولي».
const spokenAt = await request(`/api/v1/events/${eventSlug}/assistant`, { method: "POST", body: JSON.stringify({ message: "انا عند جناح افريقيا، وين الحمام؟" }) });
if (spokenAt.body?.data?.position?.source !== "spoken" || spokenAt.body.data.position.zone !== "africa") throw new Error("«انا عند …» must set a spoken position");
const nearbySpoken = await request(`/api/v1/events/${eventSlug}/nearby?category=prayer`);
if (nearbySpoken.body?.data?.origin?.source !== "spoken" || nearbySpoken.body.data.origin.zone !== "africa") throw new Error("«حولي» must use the spoken position when there is no GPS");

// Audit 6.3: another site's page cannot change a visit; pages carry a per-response script nonce.
const foreign = await fetch(`${baseUrl}/api/v1/events/${eventSlug}/session`, {
  method: "POST",
  headers: { origin: "https://attacker.example", "content-type": "application/json" },
  body: JSON.stringify({ clientType: "web", locale: "ar-SA" }),
});
const foreignBody = await foreign.json().catch(() => null);
if (foreign.status !== 403 || foreignBody?.error?.code !== "ORIGIN_FORBIDDEN") throw new Error(`a foreign Origin must get 403 ORIGIN_FORBIDDEN, got ${foreign.status}`);
const page = await fetch(`${baseUrl}/e/${eventSlug}`);
const csp = page.headers.get("content-security-policy") ?? "";
const nonce = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
if (!nonce || !csp.includes("'strict-dynamic'") || /script-src[^;]*'unsafe-inline'/.test(csp)) throw new Error(`pages need a nonce-based script-src, got: ${csp}`);
if (!(await page.text()).includes(`nonce="${nonce}"`)) throw new Error("the page's scripts must carry the response's nonce");

await request(`/api/v1/events/${eventSlug}/session`, { method: "DELETE" });
console.log(JSON.stringify({ event: eventSlug, secondEvent: secondEvent.body.data.eventSlug, sessionId: session.body.data.sessionId, itineraryId: itinerary.body.data.itineraryId, assistantIntent: assistant.body.data.intent, liveRevision: live.body.data.revision, replanMode: replan.body.data.mode, revocation: "passed", guestProfile: "passed", directions: "passed", position: "passed", returningGuest: "passed", linkCodes: "passed", originGuard: "passed", scriptNonce: "passed" }));
