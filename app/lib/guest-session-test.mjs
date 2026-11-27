// اختبار وظائف ملف الضيف المجانية: التوكن، الكوكي، وتنظيف لقطة التفضيلات
import assert from "node:assert/strict";

const guest = await import("../lib/guest-session.ts");

// التوكن: فريد وبصيغة base64url بطول معقول
const tokens = new Set(Array.from({ length: 20 }, () => guest.createGuestToken()));
assert.equal(tokens.size, 20, "guest tokens must be unique");
for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]{40,}$/);

// الهاش: ثابت ونفس أسلوب جلسة الزائر (sha256 hex)
assert.equal(guest.hashGuestToken("abc"), guest.hashGuestToken("abc"));
assert.equal(guest.hashGuestToken("abc").length, 64);
assert.notEqual(guest.hashGuestToken("abc"), guest.hashGuestToken("abd"));

// قراءة الكوكي: عادي، مشفر URI، غائب، أو تالف
function reqWithCookie(value) {
  return new Request("https://wanees.test/api/v1/guest", { headers: { cookie: value } });
}
assert.equal(guest.readGuestToken(reqWithCookie(`${guest.GUEST_COOKIE}=tok1`)), "tok1");
assert.equal(guest.readGuestToken(reqWithCookie("other=1; wanees_guest=tok%202")), "tok 2");
assert.equal(guest.readGuestToken(reqWithCookie("unrelated=1")), null);
assert.equal(guest.readGuestToken(new Request("https://wanees.test/api/v1/guest")), null);

// كتابة الكوكي: HttpOnly + Max-Age سنة، وSecure في الإنتاج فقط
const res = new Response(null);
guest.setGuestCookie(res, "tok1");
const cookie = res.headers.get("set-cookie") ?? "";
assert.ok(cookie.includes("HttpOnly"), "guest cookie must be HttpOnly");
assert.ok(cookie.includes("Max-Age=31536000"), "guest cookie lives one year");
assert.ok(!cookie.includes("Secure"), "no Secure outside production");

const cleared = new Response(null);
guest.clearGuestCookie(cleared);
assert.ok((cleared.headers.get("set-cookie") ?? "").includes("Max-Age=0"));

// تنظيف لقطة التفضيلات: يحفظ المعلوم فقط ويقص الحدود
const clean = guest.sanitizePreferencesSnapshot({
  companions: "أصدقاء",
  mood: "هادئ",
  interests: ["طعام", "", "ألعاب"],
  budgetMaxCents: 12345.7,
  availableMinutes: 999999,
  startPointId: "zone-main",
  junk: "drop me",
});
assert.deepEqual(clean, {
  companions: "أصدقاء",
  mood: "هادئ",
  interests: ["طعام", "ألعاب"],
  budgetMaxCents: 12346,
  availableMinutes: 1440,
  startPointId: "zone-main",
});
assert.equal(guest.sanitizePreferencesSnapshot(null), null);
assert.equal(guest.sanitizePreferencesSnapshot("nonsense"), null);
assert.equal(guest.sanitizePreferencesSnapshot({ junk: 1 }), null);

// دمج المفاتيح المزارة: ترتيب أول ظهور، بلا تكرار، وآخر N فقط
assert.deepEqual(guest.mergeVisitedKeys(["a", "b"], ["b", "c", "", 7, "  "], 200), ["a", "b", "c"]);
assert.deepEqual(guest.mergeVisitedKeys(["a", "b", "c"], ["d", "e"], 3), ["c", "d", "e"]);
assert.equal(guest.mergeVisitedKeys([], ["x".repeat(500)], 10)[0].length, 120);
assert.deepEqual(guest.cleanVisitedKeys(["a", "a", null, " ", "b"]), ["a", "b"]);
// Two writers that each merge into the latest locked value keep every key.
const afterFirst = guest.mergeVisitedKeys(["a"], ["tab1"], 200);
assert.deepEqual(guest.mergeVisitedKeys(afterFirst, ["tab2"], 200), ["a", "tab1", "tab2"]);

// A returning guest's new plan skips earlier visits, except what they asked for by name.
assert.deepEqual(guest.repeatsToAvoid(["a", "b", "a", "c"], ["b"]), ["a", "c"]);
assert.deepEqual(guest.repeatsToAvoid([], ["b"]), []);

// A guest who registers: history merges, the visitor's own taste wins, the guest's fills a gap.
const merged = guest.mergeGuestIntoVisitor({ visitedKeys: ["a", "b"], preferences: null }, { visitedKeys: ["b", "c"], preferences: { mood: "هادئ" } });
assert.deepEqual(merged, { visitedKeys: ["a", "b", "c"], preferences: { mood: "هادئ" } });
assert.equal(guest.mergeGuestIntoVisitor({ visitedKeys: [], preferences: { partySize: 3 } }, { visitedKeys: [], preferences: { mood: "هادئ" } }).preferences, null);
assert.equal(guest.mergeGuestIntoVisitor({ visitedKeys: [], preferences: null }, { visitedKeys: [], preferences: null }).preferences, null);

console.log("guest-session: all assertions passed");
