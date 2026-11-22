import { translator, type Translator } from "@/i18n/catalog";
import board from "@/messages/pikadoku-board";

type T = Translator<typeof board.en>;

/**
 * Tooltip text for a category header: exactly what counts, forms included.
 * Matches how the categories are computed (lib/pikadoku/categories). In English
 * unless given the page's translator; `typeName` is the type as the page shows it
 * (English: "Fire").
 */
export function categoryHint(id: string, t: T = translator(board, "en", undefined), typeName?: string): string {
  const [kind, a] = id.split(":");
  switch (kind) {
    case "type":
      return t("hint.type", { type: typeName ?? a[0].toUpperCase() + a.slice(1) });
    case "types":
      return t("hint.types");
    case "region":
      return t(a === "hisui" ? "hint.hisui" : "hint.region");
    case "form":
      return t("hint.form");
    case "evo":
      switch (a) {
        case "basic":
        case "stage2":
        case "stage3":
          return t("hint.stage");
        case "item":
          return t("hint.item");
        case "stone":
          return t("hint.stone");
        case "trade":
        case "friend":
          return t("hint.kind");
        case "level":
          return t("hint.level");
        case "branch":
          return t("hint.branch");
        case "three":
          return t("hint.three");
        case "none":
          return t("hint.none");
        default:
          return t("hint.evo");
      }
    case "move":
      return t("hint.move");
    case "ability":
      return t(id === "ability:hidden" ? "hint.hidden" : "hint.ability");
    case "stat":
      return t("hint.stat");
    default:
      break;
  }
  switch (id) {
    case "other:mega":
      return t("hint.mega");
    case "other:gmax":
      return t("hint.gmax");
    case "other:paradox":
      return t("hint.paradox");
    case "other:ultrabeast":
      return t("hint.ultrabeast");
    case "other:partner":
      return t("hint.partner");
    case "other:ou":
      return t("hint.ou");
    default:
      return t("hint.status");
  }
}
