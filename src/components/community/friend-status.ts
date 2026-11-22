import type { Translator } from "@/i18n/catalog";
import type { FriendView } from "@/lib/community";
import friends from "@/messages/friends";

export type FriendsT = Translator<typeof friends.en>;

/**
 * What a friend is doing, as their friends see it. English: the server's words ("In a Random Battle"); another
 * language: the kind of activity in it (the server's details, such as a battle's format, are English).
 */
export function friendStatus(t: FriendsT, friend: FriendView): string {
  if (!friend.online) return t("offline");
  if (t.locale === "en") return friend.activity?.label ?? t("online");
  return friend.activity ? t(`activity.${friend.activity.kind}`) : t("online");
}
