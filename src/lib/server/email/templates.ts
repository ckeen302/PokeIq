import "server-only";

/**
 * The emails, as inline-styled HTML (email clients drop <style> and classes)
 * plus a plain-text part. Dark, like the site.
 */

export interface Message {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** Each daily's button, in the order the home page lists them. */
export const DAILY_LINKS: { label: string; path: string }[] = [
  { label: "Pokédle", path: "/pokedle" },
  { label: "PokéGuessr daily", path: "/guessr" },
  { label: "Connections", path: "/connections" },
  { label: "Pikadoku", path: "/pikadoku" },
  { label: "Daily Challenge", path: "/daily" },
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

export function streakLine(s: AtRiskStreak): string {
  return `Your ${s.days}-day ${STREAK_GAME_LABEL[s.game]} streak ends at midnight.`;
}

function button(href: string, label: string, primary: boolean): string {
  const bg = primary ? C.pink : C.card;
  const border = primary ? C.pink : C.border;
  return `<tr><td style="padding:0 0 10px 0;"><a href="${escapeHtml(href)}" style="display:block;background:${bg};border:1px solid ${border};border-radius:10px;color:#ffffff;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;padding:14px 18px;text-align:center;text-decoration:none;">${escapeHtml(label)}</a></td></tr>`;
}

function shell(opts: { preheader: string; body: string; footer: string }): string {
  return `<!doctype html>
<html lang="en">
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
}

export const DAILY_SUBJECT = "Today's PokéIQ dailies are live";

export function dailyEmail(i: DailyEmailInput): Message {
  const subject = `${i.test ? "[Test] " : ""}${DAILY_SUBJECT}`;
  const link = (path: string) => `${i.siteUrl}${path}`;
  const why = `You're getting this because you turned on daily reminder emails for the trainer ${i.username} on PokéIQ.`;
  const streak = i.streak ? streakLine(i.streak) : null;

  const body = [
    `<p style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${C.violet};">Daily #${i.dailyNumber}</p>`,
    `<h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;color:${C.text};">Today's dailies are live</h1>`,
    `<a href="${escapeHtml(link("/guessr"))}" style="display:block;text-decoration:none;"><img src="${escapeHtml(i.imageUrl)}" width="478" alt="Today's PokéGuessr picture, blurred" style="display:block;width:100%;max-width:478px;height:auto;border:0;border-radius:10px;background:${C.border};"></a>`,
    `<p style="margin:10px 0 18px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};">Where in the Pokémon world is this? Today's PokéGuessr starts here.</p>`,
    streak
      ? `<p style="margin:0 0 18px 0;padding:12px 14px;border:1px solid ${C.orange};border-radius:10px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;color:${C.orange};">🔥 ${escapeHtml(streak)}</p>`
      : "",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${DAILY_LINKS.map((d, n) => button(link(d.path), d.label, n === 0)).join("")}</table>`,
  ].join("\n");

  const footer = [
    `<p style="margin:0 0 8px 0;">${escapeHtml(why)}</p>`,
    `<p style="margin:0 0 8px 0;"><a href="${escapeHtml(i.unsubscribeUrl)}" style="color:${C.text};text-decoration:underline;">Unsubscribe</a> &nbsp;·&nbsp; <a href="${escapeHtml(i.settingsUrl)}" style="color:${C.muted};text-decoration:underline;">Email settings</a></p>`,
    i.postalAddress ? `<p style="margin:0;">${escapeHtml(i.postalAddress)}</p>` : "",
  ].join("\n");

  const text = [
    `PokéIQ Daily #${i.dailyNumber}`,
    "Today's dailies are live.",
    "",
    ...(streak ? [`🔥 ${streak}`, ""] : []),
    ...DAILY_LINKS.map((d) => `${d.label}: ${link(d.path)}`),
    "",
    "--",
    why,
    `Unsubscribe: ${i.unsubscribeUrl}`,
    `Email settings: ${i.settingsUrl}`,
    ...(i.postalAddress ? [i.postalAddress] : []),
  ].join("\n");

  return {
    to: i.to,
    subject,
    html: shell({ preheader: streak ?? "Pokédle, PokéGuessr, Connections, Pikadoku and the Daily Challenge are up.", body, footer }),
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
}

export function confirmEmail(i: ConfirmEmailInput): Message {
  const body = [
    `<h1 style="margin:0 0 12px 0;font-family:${FONT};font-size:22px;line-height:28px;font-weight:800;color:${C.text};">Confirm your email</h1>`,
    `<p style="margin:0 0 18px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.muted};">Confirm this address for the trainer <b style="color:${C.text};">${escapeHtml(i.username)}</b> to get PokéIQ's daily reminder emails. Nothing is sent until you do.</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${button(i.confirmUrl, "Confirm email", true)}</table>`,
    `<p style="margin:8px 0 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:${C.muted};">The link works for 7 days. If you didn't ask for this, ignore this email and nothing more will be sent.</p>`,
  ].join("\n");
  const footer = [
    `<p style="margin:0 0 8px 0;">You're getting this because this address was entered for daily reminder emails on PokéIQ.</p>`,
    i.postalAddress ? `<p style="margin:0;">${escapeHtml(i.postalAddress)}</p>` : "",
  ].join("\n");
  const text = [
    "Confirm your email",
    "",
    `Confirm this address for the trainer ${i.username} to get PokéIQ's daily reminder emails. Nothing is sent until you do.`,
    "",
    i.confirmUrl,
    "",
    "The link works for 7 days. If you didn't ask for this, ignore this email and nothing more will be sent.",
    ...(i.postalAddress ? ["", i.postalAddress] : []),
  ].join("\n");
  return { to: i.to, subject: "Confirm your email for PokéIQ", html: shell({ preheader: "One click and you're set.", body, footer }), text };
}
