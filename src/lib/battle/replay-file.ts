/**
 * A downloadable replay file in Pokémon Showdown's own format: the same HTML
 * Showdown's "Download replay" saves (createReplayFile in the client's
 * battle-log.ts), so the file opens in any browser and plays in Showdown's
 * replay player, with the text log readable offline.
 *
 * Adapted from pokemon-showdown-client, play.pokemonshowdown.com/src/battle-log.ts
 * (BattleLog.createReplayFile), by Guangcong Luo and contributors.
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2011-2026 Guangcong Luo and other contributors
 * http://pokemonshowdown.com/
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import type { PlayFormatId } from "./play";
import type { ReplayData } from "./replay";

export function escapeHTML(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const toID = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Showdown's replay stylesheet, so the file reads without an internet connection. */
const STYLE =
  "html,body {font-family:Verdana, sans-serif;font-size:10pt;margin:0;padding:0;}body{padding:12px 0;} .battle-log {font-family:Verdana, sans-serif;font-size:10pt;} .battle-log-inline {border:1px solid #AAAAAA;background:#EEF2F5;color:black;max-width:640px;margin:0 auto 80px;padding-bottom:5px;} .battle-log .inner {padding:4px 8px 0px 8px;} .battle-log .inner-preempt {padding:0 8px 4px 8px;} .battle-log .inner-after {margin-top:0.5em;} .battle-log h2 {margin:0.5em -8px;padding:4px 8px;border:1px solid #AAAAAA;background:#E0E7EA;border-left:0;border-right:0;font-family:Verdana, sans-serif;font-size:13pt;} .battle-log .chat {vertical-align:middle;padding:3px 0 3px 0;font-size:8pt;} .battle-log .chat strong {color:#40576A;} .battle-log .chat em {padding:1px 4px 1px 3px;color:#000000;font-style:normal;} .chat.mine {background:rgba(0,0,0,0.05);margin-left:-8px;margin-right:-8px;padding-left:8px;padding-right:8px;} .spoiler {color:#BBBBBB;background:#BBBBBB;padding:0px 3px;} .spoiler:hover, .spoiler:active, .spoiler-shown {color:#000000;background:#E2E2E2;padding:0px 3px;} .spoiler a {color:#BBBBBB;} .spoiler:hover a, .spoiler:active a, .spoiler-shown a {color:#2288CC;} .chat code, .chat .spoiler:hover code, .chat .spoiler:active code, .chat .spoiler-shown code {border:1px solid #C0C0C0;background:#EEEEEE;color:black;padding:0 2px;} .chat .spoiler code {border:1px solid #CCCCCC;background:#CCCCCC;color:#CCCCCC;} .battle-log .rated {padding:3px 4px;} .battle-log .rated strong {color:white;background:#89A;padding:1px 4px;border-radius:4px;} .spacer {margin-top:0.5em;} .message-announce {background:#6688AA;color:white;padding:1px 4px 2px;} .message-announce a, .broadcast-green a, .broadcast-blue a, .broadcast-red a {color:#DDEEFF;} .broadcast-green {background-color:#559955;color:white;padding:2px 4px;} .broadcast-blue {background-color:#6688AA;color:white;padding:2px 4px;} .infobox {border:1px solid #6688AA;padding:2px 4px;} .infobox-limited {max-height:200px;overflow:auto;overflow-x:hidden;} .broadcast-red {background-color:#AA5544;color:white;padding:2px 4px;} .message-learn-canlearn {font-weight:bold;color:#228822;text-decoration:underline;} .message-learn-cannotlearn {font-weight:bold;color:#CC2222;text-decoration:underline;} .message-effect-weak {font-weight:bold;color:#CC2222;} .message-effect-resist {font-weight:bold;color:#6688AA;} .message-effect-immune {font-weight:bold;color:#666666;} .message-learn-list {margin-top:0;margin-bottom:0;} .message-throttle-notice, .message-error {color:#992222;} .message-overflow, .chat small.message-overflow {font-size:0pt;} .message-overflow::before {font-size:9pt;content:'...';} .subtle {color:#3A4A66;}";

/** The log as the battle-log-data block holds it: one protocol line per line, private (|split|) halves dropped. */
export function replayLogData(log: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < log.length; i++) {
    const line = log[i];
    // A |split|pN block is followed by the private line and the public one: keep the public one only.
    if (line.startsWith("|split|")) {
      out.push(log[i + 2] ?? "");
      i += 2;
      continue;
    }
    if (line.startsWith("|request|")) continue;
    out.push(line);
  }
  return out;
}

export interface ReplayFileInput {
  /** The replay's id (Showdown prefixes ids from other servers: ours read "pokeiq-…"). */
  id: string;
  /** The format's name ("[Gen 9] Random Battle"). */
  format: string;
  players: [string, string];
  log: readonly string[];
  /** The text log, as HTML (the battle log, one line per element), for reading offline. */
  logHtml: string;
}

/** Showdown's replay file (version 1), byte for byte the same layout as its "Download replay". */
export function replayFileHtml({ id, format, players, log, logHtml }: ReplayFileInput): string {
  const [p1, p2] = players;
  let buf = "<!DOCTYPE html>\n";
  buf += '<meta charset="utf-8" />\n';
  buf += "<!-- version 1 -->\n";
  buf += `<title>${escapeHTML(format)} replay: ${escapeHTML(p1)} vs. ${escapeHTML(p2)}</title>\n`;
  buf += "<style>\n" + STYLE + "\n</style>\n";
  buf += '<div class="wrapper replay-wrapper" style="max-width:1180px;margin:0 auto">\n';
  buf += `<input type="hidden" name="replayid" value="${escapeHTML(`pokeiq-${id}`)}" />\n`;
  buf += '<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>\n';
  buf += `<h1 style="font-weight:normal;text-align:center"><strong>${escapeHTML(format)}</strong><br /><a href="https://pokemonshowdown.com/users/${toID(p1)}" class="subtle" target="_blank">${escapeHTML(p1)}</a> vs. <a href="https://pokemonshowdown.com/users/${toID(p2)}" class="subtle" target="_blank">${escapeHTML(p2)}</a></h1>\n`;
  // "</script>" can't appear inside the block: Showdown escapes every slash.
  buf += '<script type="text/plain" class="battle-log-data">' + replayLogData(log).join("\n").replace(/\//g, "\\/") + "</script>\n";
  buf += "</div>\n";
  buf += '<div class="battle-log battle-log-inline"><div class="inner">' + logHtml + "</div></div>\n";
  buf += "</div>\n";
  buf += "<script>\n";
  buf += "let daily = Math.floor(Date.now()/1000/60/60/24);document.write('<script src=\"https://play.pokemonshowdown.com/js/replay-embed.js?version'+daily+'\"></'+'script>');\n";
  buf += "</script>\n";
  return buf;
}

/** One line of the text log as Showdown's log shows it ("Turn 3" headings, **bold** as <strong>). */
export function logLineHtml(text: string, turn?: number): string {
  if (turn !== undefined) return `<h2 class="battle-history">Turn ${turn}</h2>`;
  const html = escapeHTML(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br />");
  return `<div class="battle-history">${html}</div>`;
}

/** A file name for the replay: "gen9randombattle-red-vs-blue-abcd2345.html". */
export function replayFileName(formatId: string, players: [string, string], id: string, ext = "html"): string {
  return `${toID(formatId)}-${toID(players[0]) || "p1"}-vs-${toID(players[1]) || "p2"}-${id}.${ext}`;
}

// ---------------------------------------------------------------------------
// Importing: a Showdown replay file (.html), a raw battle log (.log, or
// pasted text) or a replay's .json, read back into our replay model.

/** The largest replay file or paste we read (Showdown's longest battles are well under this). */
export const IMPORT_MAX_BYTES = 2_000_000;

export type ImportResult = { ok: true; replay: ReplayData } | { ok: false; error: string };

const unescapeHtml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&");

/** Spectator chatter and room lines: not part of the battle. */
const ROOM_LINE = /^\|(?:c|chat|c:|j|J|l|L|n|N|raw|html|uhtml|uhtmlchange|inactive|inactiveoff|t:|chatmsg|chatmsg-raw|join|leave|name)\|/;

/** The protocol text inside whatever was given: the replay file's log block, a .json's `log`, or the text itself. */
function protocolText(input: string): string {
  const text = input.replace(/^﻿/, "");
  // Replay files: <script type="text/plain" class="battle-log-data"> (older ones: class="log").
  const block = /<script[^>]*class="(?:battle-log-data|log)"[^>]*>([\s\S]*?)<\/script>/i.exec(text);
  if (block) return block[1].replace(/\\\//g, "/");
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed) as { log?: unknown };
      if (typeof json.log === "string") return json.log;
    } catch {
      // Not JSON after all: read it as a log.
    }
  }
  // A log copied out of an HTML page may still carry entities.
  return /&(?:lt|gt|amp|quot);/.test(text) && !text.includes("<") ? unescapeHtml(text) : text;
}

/**
 * Reads a Showdown battle log, replay file or replay .json into a replay
 * (id "imported"). Only public lines are kept: a |split| block keeps its
 * spectator half and |request| lines are dropped, so nothing hidden shows.
 * `formats` is our format table (the screen needs one of ours for its layout).
 */
export function parseShowdownReplay(input: string, formats: Partial<Record<PlayFormatId, { name: string }>>): ImportResult {
  if (!input.trim()) return { ok: false, error: "Paste a battle log or choose a replay file." };
  if (input.length > IMPORT_MAX_BYTES) return { ok: false, error: "That file is too big to be a battle replay." };
  const raw = protocolText(input)
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.startsWith("|"));
  const log = replayLogData(raw).filter((l) => l !== "" && !ROOM_LINE.test(l));
  const names: [string, string] = ["", ""];
  let tier = "";
  let gameType: "singles" | "doubles" | "other" = "singles";
  let winnerName: string | null | undefined;
  let turns = 0;
  for (const line of log) {
    const parts = line.split("|");
    if (parts[1] === "player" && (parts[2] === "p1" || parts[2] === "p2") && parts[3]) names[parts[2] === "p1" ? 0 : 1] = parts[3];
    else if (parts[1] === "tier") tier = parts[2] ?? "";
    else if (parts[1] === "gametype") gameType = parts[2] === "doubles" ? "doubles" : parts[2] === "singles" ? "singles" : "other";
    else if (parts[1] === "win") winnerName = parts[2] ?? "";
    else if (parts[1] === "tie") winnerName = null;
    else if (parts[1] === "turn") turns = Math.max(turns, Number(parts[2]) || 0);
  }
  if (!names[0] || !names[1] || !log.some((l) => /^\|(?:switch|drag)\|/.test(l))) {
    return { ok: false, error: "That doesn't look like a Showdown battle log: no players or Pokémon found." };
  }
  if (gameType === "other") return { ok: false, error: "Only singles and doubles battles can be watched here." };
  const formatId = toID(tier.replace(/^\[Gen (\d+)\]/i, "gen$1"));
  const format: PlayFormatId = formatId in formats ? (formatId as PlayFormatId) : gameType === "doubles" ? "gen9doublesou" : "custom";
  const winner = winnerName == null ? null : winnerName === names[0] ? 0 : winnerName === names[1] ? 1 : null;
  return {
    ok: true,
    replay: {
      id: "imported",
      format,
      formatName: tier || "Imported battle",
      players: names,
      winner,
      reason: winnerName === undefined ? "nocontest" : "normal",
      turns,
      ranked: false,
      public: false,
      uploadedAt: 0,
      log,
    },
  };
}

/** Where each faint happens: the turn steps (as the viewer counts them) whose turn saw a Pokémon faint. */
export function koSteps(log: readonly string[]): number[] {
  const steps = new Set<number>();
  let turn = 0;
  for (const line of log) {
    const m = /^\|turn\|(\d+)/.exec(line);
    if (m) turn = Number(m[1]);
    // A faint during turn t shows once step t + 1 (the next turn's start) is on screen.
    else if (line.startsWith("|faint|")) steps.add(turn + 1);
  }
  return [...steps].sort((a, b) => a - b);
}
