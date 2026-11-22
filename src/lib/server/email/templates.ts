import "server-only";
import { translator, type Translator } from "@/i18n/catalog";
import type { Locale, OtherLocale } from "@/i18n/config";
import { localeHref } from "@/i18n/href";
import mail from "@/messages/email-mail";
import ja from "@/messages/ja/email-mail.json";
import es from "@/messages/es/email-mail.json";
import fr from "@/messages/fr/email-mail.json";
import de from "@/messages/de/email-mail.json";
import it from "@/messages/it/email-mail.json";

/**
 * The emails, as inline-styled HTML (email clients drop <style> and classes)
 * plus a plain-text part. Dark, like the site.
 *
 * Each template takes an optional `locale` (the email-mail namespace, English by default): no trainer's language is
 * stored yet, so every sender sends English today.
 */

type MailT = Translator<typeof mail.en>;
const MESSAGES: Record<OtherLocale, unknown> = { ja, es, fr, de, it };

/** The email's words in a language (English without one). */
export function mailT(locale: Locale = "en"): MailT {
  return translator(mail, locale, locale === "en" ? undefined : (MESSAGES[locale] as Parameters<typeof translator>[2]));
}

export interface Message {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** Each daily's button, in the order the home page lists them (`key`: its label in email-mail's links). */
export const DAILY_LINKS: { label: string; path: string; key: keyof typeof mail.en.links }[] = [
  { label: "Pokédle", path: "/pokedle", key: "pokedle" },
  { label: "PokéGuessr daily", path: "/pokeguessr", key: "geo" },
  { label: "Connections", path: "/pokeconnections", key: "conn" },
  { label: "Pikadoku", path: "/pikadoku", key: "pdk" },
  { label: "Daily Challenge", path: "/daily", key: "daily" },
];

export type StreakGame = "daily" | "dle" | "conn" | "pdk" | "geo";
export const STREAK_GAME_LABEL: Record<StreakGame, string> = {
  daily: "Daily Challenge",
  dle: "Pokédle",
  conn: "Connections",
  pdk: "Pikadoku",
  geo: "PokéGuessr daily",
};

export interface AtRiskStreak {
  game: StreakGame;
  days: number;
}

const C = {
  bg: "#0d0c1a",
  card: "#16152b",
  border: "#2a2846",
  text: "#f3f2fb",
  muted: "#a9a6c2",
  pink: "#f1417c",
  violet: "#a47efb",
  orange: "#fb923c",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** email-mail's links key of each streak's game (STREAK_GAME_LABEL's English). */
const STREAK_GAME_KEY: Record<StreakGame, keyof typeof mail.en.links> = { daily: "daily", dle: "pokedle", conn: "conn", pdk: "pdk", geo: "geo" };

export function streakLine(s: AtRiskStreak, t: MailT = mailT()): string {
  return t("streak", { days: s.days, game: t(`links.${STREAK_GAME_KEY[s.game]}`) });
}

function button(href: string, label: string, primary: boolean): string {
  const bg = primary ? C.pink : C.card;
  const border = primary ? C.pink : C.border;
  return `<tr><td style="padding:0 0 10px 0;"><a href="${escapeHtml(href)}" style="display:block;background:${bg};border:1px solid ${border};border-radius:10px;color:#ffffff;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;padding:14px 18px;text-align:center;text-decoration:none;">${escapeHtml(label)}</a></td></tr>`;
}

function shell(opts: { preheader: string; body: string; footer: string; lang?: Locale }): string {
  return `<!doctype html>
<html lang="${opts.lang ?? "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>PokéIQ</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.text};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td style="padding:0 4px 16px 4px;font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:0.5px;color:${C.text};">Poké<span style="color:${C.pink};">IQ</span></td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:24px 20px;">
${opts.body}
</td></tr>
<tr><td style="padding:18px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};">
${opts.footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export interface DailyEmailInput {
  to: string;
  username: string;
  date: string;
  dailyNumber: number;
  siteUrl: string;
  imageUrl: string;
  unsubscribeUrl: string;
  settingsUrl: string;
  postalAddress: string | null;
  streak: AtRiskStreak | null;
  test?: boolean;
  /** The recipient's language: the email's words and its links to the site's pages in it. English by default. */
  locale?: Locale;
}

export const DAILY_SUBJECT = "Today's PokéIQ dailies are live";

export function dailyEmail(i: DailyEmailInput): Message {
  const locale = i.locale ?? "en";
  const t = mailT(locale);
  const subject = i.test ? t("daily.testSubject", { subject: t("daily.subject") }) : t("daily.subject");
  const link = (path: string) => `${i.siteUrl}${localeHref(path, locale).href}`;
  const why = t("daily.why", { name: i.username });
  const streak = i.streak ? streakLine(i.streak, t) : null;

  const body = [
    `<p style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${C.violet};">${escapeHtml(t("daily.kicker", { n: i.dailyNumber }))}</p>`,
    `<h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;color:${C.text};">${t("daily.heading")}</h1>`,
    `<a href="${escapeHtml(link("/pokeguessr"))}" style="display:block;text-decoration:none;"><img src="${escapeHtml(i.imageUrl)}" width="478" alt="${t("daily.imageAlt")}" style="display:block;width:100%;max-width:478px;height:auto;border:0;border-radius:10px;background:${C.border};"></a>`,
    `<p style="margin:10px 0 18px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};">${t("daily.imageCaption")}</p>`,
    streak
      ? `<p style="margin:0 0 18px 0;padding:12px 14px;border:1px solid ${C.orange};border-radius:10px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;color:${C.orange};">🔥 ${escapeHtml(streak)}</p>`
      : "",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${DAILY_LINKS.map((d, n) => button(link(d.path), t(`links.${d.key}`), n === 0)).join("")}</table>`,
  ].join("\n");

  const footer = [
    `<p style="margin:0 0 8px 0;">${escapeHtml(why)}</p>`,
    `<p style="margin:0 0 8px 0;"><a href="${escapeHtml(i.unsubscribeUrl)}" style="color:${C.text};text-decoration:underline;">${t("daily.unsubscribe")}</a> &nbsp;·&nbsp; <a href="${escapeHtml(i.settingsUrl)}" style="color:${C.muted};text-decoration:underline;">${t("daily.settings")}</a></p>`,
    i.postalAddress ? `<p style="margin:0;">${escapeHtml(i.postalAddress)}</p>` : "",
  ].join("\n");

  const text = [
    t("daily.textTitle", { n: i.dailyNumber }),
    t("daily.textHeading"),
    "",
    ...(streak ? [`🔥 ${streak}`, ""] : []),
    ...DAILY_LINKS.map((d) => `${t(`links.${d.key}`)}: ${link(d.path)}`),
    "",
    "--",
    why,
    t("daily.textUnsubscribe", { url: i.unsubscribeUrl }),
    t("daily.textSettings", { url: i.settingsUrl }),
    ...(i.postalAddress ? [i.postalAddress] : []),
  ].join("\n");

  return {
    to: i.to,
    subject,
    html: shell({ preheader: streak ?? t("daily.preheader"), body, footer, lang: locale }),
    text,
    headers: {
      "List-Unsubscribe": `<${i.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export interface ConfirmEmailInput {
  to: string;
  username: string;
  confirmUrl: string;
  postalAddress: string | null;
  /** The recipient's language (English by default). */
  locale?: Locale;
}

export function confirmEmail(i: ConfirmEmailInput): Message {
  const t = mailT(i.locale);
  // The translated text is ours (written as HTML-safe text, as the English always was); only the trainer's name is escaped.
  const body = [
    `<h1 style="margin:0 0 12px 0;font-family:${FONT};font-size:22px;line-height:28px;font-weight:800;color:${C.text};">${t("confirm.heading")}</h1>`,
    `<p style="margin:0 0 18px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.muted};">${t("confirm.body", { name: `<b style="color:${C.text};">${escapeHtml(i.username)}</b>` })}</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${button(i.confirmUrl, t("confirm.button"), true)}</table>`,
    `<p style="margin:8px 0 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:${C.muted};">${t("confirm.note")}</p>`,
  ].join("\n");
  const footer = [
    `<p style="margin:0 0 8px 0;">${t("confirm.why")}</p>`,
    i.postalAddress ? `<p style="margin:0;">${escapeHtml(i.postalAddress)}</p>` : "",
  ].join("\n");
  const text = [
    t("confirm.heading"),
    "",
    t("confirm.body", { name: i.username }),
    "",
    i.confirmUrl,
    "",
    t("confirm.note"),
    ...(i.postalAddress ? ["", i.postalAddress] : []),
  ].join("\n");
  return { to: i.to, subject: t("confirm.subject"), html: shell({ preheader: t("confirm.preheader"), body, footer, lang: i.locale }), text };
}
