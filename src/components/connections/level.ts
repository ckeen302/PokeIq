import type { Translator } from "@/i18n/catalog";
import type board from "@/messages/connections-board";
import type { ConnLevel } from "@/lib/connections/types";

/** A level's colour name ("Yellow"), in the page's language (its own file: the Create page needs nothing else of ./parts). */
export const levelName = (t: Translator<typeof board.en>, level: ConnLevel) => t(`level.${level}`);
