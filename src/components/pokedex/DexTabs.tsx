import { ClientMessages } from "@/i18n/ClientMessages";
import dexTabs from "@/messages/dex-tabs";
import { DexTabsMenu, type DexTabId } from "./DexTabsMenu";

export type { DexTabId };

/**
 * The Pokédex's section button (DexTabsMenu), with its own text in the page's language: any Pokédex page can show it
 * without listing its namespace. On an English page it is the menu alone.
 */
export function DexTabs({ active }: { active: DexTabId }) {
  return (
    <ClientMessages namespaces={[dexTabs]}>
      <DexTabsMenu active={active} />
    </ClientMessages>
  );
}
