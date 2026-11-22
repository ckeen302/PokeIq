import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { CHALLENGE_ALT, challengeCard } from "@/lib/og/challenge";
import { ogT } from "@/lib/og/i18n";

/** Invite preview: the same generic challenge card for every code, so it never gives anything away. */

export const alt = CHALLENGE_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  return challengeCard("quiz", await ogT(props));
}
