/**
 * The one email the service sends: a sign-in code. Through Resend's HTTP
 * API when RESEND_API_KEY is set, from hello@opentaxrate.com. Without it,
 * outside production the code is printed instead, for local sign-in; in
 * production sending fails, so nobody waits for a code that never comes.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

let override: Mailer | undefined;

/** For tests: capture mail instead of sending it. */
export function setMailer(mailer: Mailer | undefined) {
  override = mailer;
}

export async function sendMail(mail: Mail, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (override) return override(mail);
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    if (env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set; can't send sign-in codes.");
    console.info(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "OpenTaxRate <hello@opentaxrate.com>",
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Resend refused the email (${response.status}).`);
}

export function signInCodeMail(to: string, code: string): Mail {
  return {
    to,
    subject: `${code} is your OpenTaxRate code`,
    text: `Your OpenTaxRate sign-in code is ${code}.\n\nIt works for 5 minutes. If you didn't ask for it, ignore this email.\n`,
  };
}
