import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { partyInviteCard } from "@/lib/og/guessr";
import { ogT } from "@/lib/og/i18n";

/** Party invite preview: the same card for every room, so it never gives anything away. */

export const runtime = "nodejs";
export const alt = "A PokéGuessr party invite: open the link to join";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  return partyInviteCard(await ogT(props));
}
