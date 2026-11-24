import { memo } from "react";
import Anchor from "@/components/ui/Anchor";

export interface CrawlLink {
  href: string;
  name: string;
}

/**
 * The rest of a long list as plain links, in the page's HTML but not on screen (`hidden`). The list above shows its
 * first entries and adds more as you scroll, which a crawler never does (and crawlers that don't run scripts never see
 * more than the first ones), so the page's HTML still links every entry. It holds only the entries the list isn't
 * showing, so no page is linked twice. Each link stays in the page's language (Anchor), like the list's own.
 */
export const CrawlLinks = memo(function CrawlLinks({ links }: { links: CrawlLink[] }) {
  if (!links.length) return null;
  return (
    <nav hidden>
      <ul>
        {links.map((l) => (
          <li key={l.href}>
            <Anchor href={l.href}>{l.name}</Anchor>
          </li>
        ))}
      </ul>
    </nav>
  );
});
