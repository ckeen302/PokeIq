"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * A link that fetches its page when it's pointed at or focused, not as soon
 * as it scrolls into view: the home page shows a tile for every tab, and
 * prefetching all of them on load would compete with the page itself.
 */
export function HoverPrefetchLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string }) {
  const router = useRouter();
  const warm = () => router.prefetch(href);
  return <Link href={href} prefetch={false} onPointerEnter={warm} onFocus={warm} onTouchStart={warm} {...props} />;
}
