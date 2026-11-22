import { serverT } from "@/i18n/server";
import battleRecord from "@/messages/battle-record";
import battleGlicko from "@/messages/battle-glicko";
import { battleRecordView, type RecordProps } from "./BattleRecordView";

/** A battle record on a server-rendered page (a trainer's profile), in the page's language. */
export function BattleProfileView(props: RecordProps) {
  return battleRecordView(props, serverT(battleRecord), serverT(battleGlicko));
}
