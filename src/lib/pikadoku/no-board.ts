import { translator, type Translator } from "@/i18n/catalog";
import pikadoku from "@/messages/pikadoku";
import type { PdkBand } from "./types";

/**
 * Plain words for an Unlimited choice that can't make a board, with what to widen. Client-safe: the server sends it
 * in English, and a page in another language says it again in its own (the reason is told apart by its first words).
 */
export function noBoardMessage(reason: "few" | "none", opts: { allowSingle: boolean; band: PdkBand }, t: Translator<typeof pikadoku.en> = translator(pikadoku, "en", undefined)): string {
  if (reason === "few") return t("noBoard.few");
  const tips = [t("noBoard.more")];
  if (opts.band !== "normal") tips.push(t("noBoard.normal"));
  if (!opts.allowSingle && opts.band !== "easy") tips.push(t("noBoard.single"));
  const sep = t.locale === "ja" ? "、" : ", ";
  const list = tips.length > 1 ? t("noBoard.or", { list: tips.slice(0, -1).join(sep), last: tips.at(-1)! }) : tips[0];
  return t("noBoard.none", { tips: list });
}

/** The server's English message, said again in the page's language (English pages show it as it came). */
export function localNoBoard(message: string, opts: { allowSingle: boolean; band: PdkBand }, t: Translator<typeof pikadoku.en>): string {
  if (t.locale === "en") return message;
  return noBoardMessage(message === noBoardMessage("few", opts) ? "few" : "none", opts, t);
}
