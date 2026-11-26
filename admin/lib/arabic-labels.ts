// Arabic wording for counts and stored enum codes shown in the organizer app.

type CountForms = { zero: string; one: string; two: string; few: string; many: string; other: string };

const pluralRules = new Intl.PluralRules("ar");

/** Arabic number agreement: forms use "{n}" for the number (3–10 plural, 11–99 singular accusative, …). */
export function arCount(n: number, forms: CountForms): string {
  const count = Math.max(0, Math.round(n));
  const category = count === 0 ? "zero" : pluralRules.select(count);
  return (forms[category as keyof CountForms] ?? forms.other).replace("{n}", String(count));
}

export const COUNT = {
  zones: { zero: "لا مناطق", one: "منطقة واحدة", two: "منطقتان", few: "{n} مناطق", many: "{n} منطقة", other: "{n} منطقة" },
  activities: { zero: "لا أنشطة", one: "نشاط واحد", two: "نشاطان", few: "{n} أنشطة", many: "{n} نشاطًا", other: "{n} نشاط" },
  locations: { zero: "لا مواقع", one: "موقع واحد", two: "موقعان", few: "{n} مواقع", many: "{n} موقعًا", other: "{n} موقع" },
  sources: { zero: "لا مصادر", one: "مصدر واحد", two: "مصدران", few: "{n} مصادر", many: "{n} مصدرًا", other: "{n} مصدر" },
  paths: { zero: "لا ممرات", one: "ممر واحد", two: "ممران", few: "{n} ممرات", many: "{n} ممرًا", other: "{n} ممر" },
  visitors: { zero: "لا زوار", one: "زائر واحد", two: "زائران", few: "{n} زوار", many: "{n} زائرًا", other: "{n} زائر" },
  sessions: { zero: "لا جلسات", one: "جلسة واحدة", two: "جلستان", few: "{n} جلسات", many: "{n} جلسة", other: "{n} جلسة" },
  updates: { zero: "لا تحديثات", one: "تحديث واحد", two: "تحديثان", few: "{n} تحديثات", many: "{n} تحديثًا", other: "{n} تحديث" },
  blockingErrors: {
    zero: "لا توجد أخطاء تمنع النشر.",
    one: "يوجد خطأ واحد يمنع النشر.",
    two: "يوجد خطآن يمنعان النشر.",
    few: "توجد {n} أخطاء تمنع النشر.",
    many: "يوجد {n} خطأً يمنع النشر.",
    other: "يوجد {n} خطأ يمنع النشر.",
  },
  warnings: { zero: "لا تنبيهات", one: "تنبيه واحد", two: "تنبيهان", few: "{n} تنبيهات", many: "{n} تنبيهًا", other: "{n} تنبيه" },
} satisfies Record<string, CountForms>;

function label(map: Record<string, string>, code: string | null | undefined) {
  return code ? map[code] ?? code : "—";
}

export const eventStatusLabel = (code: string) => label({
  DRAFT: "مسودة", PUBLISHED: "منشورة", LIVE: "مباشرة", COMPLETED: "انتهت", ARCHIVED: "مؤرشفة",
}, code);

export const activityStatusLabel = (code: string) => label({
  ACTIVE: "متاح", TEMPORARILY_CLOSED: "مغلق مؤقتًا", EXPIRED: "منتهي",
}, code);

export const nodeTypeLabel = (code: string) => label({
  ENTRANCE: "بوابة", ZONE: "منطقة", ACTIVITY: "نشاط", LANDMARK: "معلم", SERVICE: "خدمة",
}, code);

export const nodeStatusLabel = (code: string) => label({ open: "مفتوح", closed: "مغلق" }, code);

export const sourceTypeLabel = (code: string) => label({
  fixture: "بيانات العرض",
  csv_candidate: "استيراد CSV",
  operator_activity: "إدخال المشغّل — نشاط",
  operator_capacity: "إدخال المشغّل — سعة",
  operator_route_edge: "قياس ممر ميداني",
}, code);

/** Repository file paths (e.g. app/data/boulevard_world.json) are internal; organizers see a friendly label. */
export function sourceLocatorLabel(locator: string) {
  if (/^[a-z]+:\/\//i.test(locator)) return locator;
  if (/^(?:\.{0,2}\/)?(?:app|data|admin|packages)\/.+\.(?:json|csv|ya?ml)$/i.test(locator)) return locator.endsWith(".csv") ? "ملف استيراد مرفق" : "ملف بيانات العرض المضمّن";
  return locator;
}

/** Prices are stored in halalas; zero is free. */
export function priceLabel(cents: number | null | undefined) {
  if (cents == null) return "غير معروف";
  return cents === 0 ? "مجانًا" : `${cents / 100} ريال`;
}

export const memberRoleLabel = (code: string) => label({
  OWNER: "مالك", ADMIN: "مدير", OPERATOR: "مشغّل", EDITOR: "محرر محتوى", ANALYST: "محلل", VIEWER: "مشاهد",
}, code);

export const userStatusLabel = (code: string) => label({
  ACTIVE: "نشط", INVITED: "مدعو — لم يدخل بعد", DISABLED: "معطّل",
}, code);

const AUDIT_ACTIONS: Record<string, string> = {
  "catalog_activity.create": "إضافة نشاط",
  "catalog_activity.update": "تعديل نشاط",
  "catalog_route_edge.save": "حفظ ممر مشي",
  "catalog_route_node.create": "إضافة موقع على الخريطة",
  "catalog_route_node.update": "تعديل موقع على الخريطة",
  "catalog_source.review": "مراجعة مصدر",
  "catalog_version.create_draft": "إنشاء مسودة كتالوج",
  "catalog_version.crosswalk_verify": "اعتماد مطابقة الكتالوج",
  "catalog_version.import_candidate": "استيراد كتالوج",
  "catalog_version.publish": "نشر نسخة الكتالوج",
  "catalog_version.rollback": "استرجاع نسخة سابقة",
  "catalog_version.validate": "فحص نسخة الكتالوج",
  "catalog_zone.capacity": "تعديل سعة منطقة",
  "catalog_zone.create": "إضافة منطقة",
  "event.create": "إنشاء فعالية",
  "event_update.create": "نشر تحديث مباشر",
  "event_update.revoke": "سحب تحديث مباشر",
  "incentive.create": "إضافة حافز",
  "incentive.update": "تعديل حافز",
  "seed.demo_catalog": "تحميل بيانات العرض",
  "visitor.delete": "حذف زائر",
  "visitor.export": "تصدير الزوار (أرقام مخفية)",
  "visitor.export_unmasked": "تصدير الزوار بالأرقام كاملة",
  "visitor.list": "عرض قائمة الزوار",
  "visitor.list_unmasked": "عرض الزوار بالأرقام كاملة",
  "visitor.reveal_phone": "إظهار رقم زائر",
  "visitor.view": "عرض سجل زائر",
  "visitor_handoff.update": "تحديث طلب مساعدة",
  "member.add": "إضافة عضو",
  "member.role_change": "تغيير دور عضو",
  "member.disable": "تعطيل حساب عضو",
  "member.enable": "تفعيل حساب عضو",
  "member.remove": "إزالة عضو",
  "member.activate": "أول دخول لعضو مدعو",
};

/** Arabic wording for stored audit action codes; unknown codes are shown as stored. */
export const auditActionLabel = (code: string) => label(AUDIT_ACTIONS, code);

export const auditEntityLabel = (code: string) => label({
  Activity: "نشاط", CatalogVersion: "نسخة كتالوج", ContentSource: "مصدر", Event: "فعالية", EventUpdate: "تحديث مباشر",
  Incentive: "حافز", RouteEdge: "ممر مشي", RouteNode: "موقع", Visitor: "زائر", VisitorHandoff: "طلب مساعدة", Zone: "منطقة",
  Membership: "عضوية", User: "مستخدم",
}, code);
