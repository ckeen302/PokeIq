import type { ReactNode } from "react";
import { ClientMessages } from "@/i18n/ClientMessages";
import room from "@/messages/battle-room";
import play from "@/messages/battle-play";
import tooltips from "@/messages/battle-tooltips";
import inputs from "@/messages/battle-inputs";
import formats from "@/messages/battle-formats";
import rules from "@/messages/battle-rules";
import group from "@/messages/battle-group";
import teamPick from "@/messages/battle-team-pick";
import frontier from "@/messages/battle-frontier";
import pickers from "@/messages/battle-pickers";
import teams from "@/messages/battle-teams";
import teamInsights from "@/messages/battle-team-insights";
import terms from "@/messages/battle-terms";
import glicko from "@/messages/battle-glicko";
import replays from "@/messages/battle-replays";
import replayWords from "@/messages/battle-replay-words";
import duel from "@/messages/duel";
import chat from "@/messages/chat";
import addFriend from "@/messages/add-friend";
import share from "@/messages/share";

/**
 * Everything a battle's page shows in another language, for its client components: the battle room and screen, the
 * lobby (its team picker and rules), the Battle Frontier's after-battle, the instant replay, the chat and the shares.
 * (The battle log's own text loads with the battle screen, only in that language.) English pages add nothing.
 */
export function BattleRoomMessages({ children }: { children: ReactNode }) {
  return (
    <ClientMessages namespaces={[room, play, tooltips, inputs, formats, rules, group, teamPick, frontier, pickers, teams, teamInsights, terms, glicko, replays, replayWords, duel, chat, addFriend, share]}>
      {children}
    </ClientMessages>
  );
}
