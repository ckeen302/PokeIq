import {
  Backpack, BadgeCheck, Brain, CalendarCheck, Compass, Crown, Flame, Footprints, Gem, GraduationCap, Map, MapPinned, Medal,
  Navigation, ScrollText, Search, Shield, Sparkles, Zap, Puzzle, Link, Link2, Diamond, Flag, Cpu, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "first-run": Backpack,
  certified: ScrollText,
  perfect: Gem,
  "streak-10": Flame,
  survivor: Shield,
  blitz: Zap,
  purist: Map,
  "iq-120": Brain,
  "iq-140": GraduationCap,
  "all-modes": BadgeCheck,
  "daily-3": CalendarCheck,
  "daily-7": Medal,
  "daily-30": Crown,
  "dle-3": Search,
  "dle-1": Sparkles,
  "geo-first": Compass,
  "geo-pinpoint": MapPinned,
  "geo-20k": Navigation,
  "geo-streak-10": Footprints,
  "conn-first": Puzzle,
  "conn-streak-7": Link2,
  "conn-streak-30": Link,
  "conn-perfect-10": Diamond,
  "conn-duel-10": Flag,
  "conn-hard": Cpu,
};

/** Gym-badge style medal: metallic octagon with an icon. */
export function BadgeMedal({ id, unlocked = true, size = "md" }: { id: string; unlocked?: boolean; size?: "sm" | "md" }) {
  const Icon = ICONS[id] ?? Medal;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        size === "md" ? "h-11 w-11" : "h-5 w-5",
        !unlocked && "opacity-40 grayscale"
      )}
      style={{ clipPath: "polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)" }}
      aria-hidden
    >
      <span className="absolute inset-0 bg-[conic-gradient(from_200deg,hsl(44_96%_70%),hsl(30_80%_40%),hsl(44_96%_75%),hsl(30_80%_38%),hsl(44_96%_70%))]" />
      <span
        className="absolute inset-[3px] bg-[radial-gradient(circle_at_35%_30%,hsl(44_96%_62%),hsl(28_80%_30%))]"
        style={{ clipPath: "polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)" }}
      />
      <Icon className={cn("relative text-[hsl(30_70%_14%)]", size === "md" ? "h-5 w-5" : "h-3 w-3")} strokeWidth={2.5} />
    </span>
  );
}
