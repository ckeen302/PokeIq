import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { CHALLENGE_ALT, challengeCard } from "@/lib/og/challenge";

/** Party invite preview: the same generic invite card for every room, so it never gives anything away. */

export const alt = CHALLENGE_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return challengeCard("geo-party");
}
