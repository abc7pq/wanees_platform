// Rules for the password an invited member chooses on first sign-in. The one-time password from
// the users page never opens a session: it only lets the member set their own password.

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export type PasswordProblem = "TOO_SHORT" | "TOO_LONG" | "SAME_AS_ONE_TIME" | "CONTAINS_EMAIL" | "TOO_SIMPLE";

export const PASSWORD_PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  TOO_SHORT: `كلمة المرور الجديدة يجب أن تكون ${MIN_PASSWORD_LENGTH} حرفًا على الأقل.`,
  TOO_LONG: "كلمة المرور الجديدة طويلة جدًا.",
  SAME_AS_ONE_TIME: "اختر كلمة مرور مختلفة عن كلمة المرور المؤقتة.",
  CONTAINS_EMAIL: "لا تستخدم بريدك الإلكتروني داخل كلمة المرور.",
  TOO_SIMPLE: "كلمة المرور سهلة التخمين. استخدم خليطًا من الحروف والأرقام أو عبارة أطول.",
};

/** The first problem with the chosen password, or null when it is acceptable. */
export function newPasswordProblem(newPassword: string, oneTimePassword: string, email: string): PasswordProblem | null {
  if (newPassword.length < MIN_PASSWORD_LENGTH) return "TOO_SHORT";
  if (newPassword.length > MAX_PASSWORD_LENGTH) return "TOO_LONG";
  if (newPassword === oneTimePassword) return "SAME_AS_ONE_TIME";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && newPassword.toLowerCase().includes(local)) return "CONTAINS_EMAIL";
  if (new Set(newPassword).size < 5) return "TOO_SIMPLE";
  return null;
}
