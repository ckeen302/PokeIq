"use client";

import { FrontierHub } from "@/components/battle/Frontier";
import { TowerStart } from "@/components/battle/TowerStart";

/** The Battle Tower's hub (client: the start panel is a render prop). Metadata lives in layout.tsx. */
export default function BattleTowerPage() {
  return <FrontierHub mode="tower" startPanel={(props) => <TowerStart {...props} />} />;
}
