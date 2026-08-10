"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Modules" },
  { href: "/daily", label: "Daily" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 text-sm">
      {LINKS.map(({ href, label }) => {
        const active =
          href === "/"
            ? pathname === "/" || pathname.startsWith("/quiz")
            : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "rounded-full px-3.5 py-1.5 transition-colors",
              active
                ? "bg-white/10 text-foreground"
                : "text-muted hover:bg-white/5 hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
