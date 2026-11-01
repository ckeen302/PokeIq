import { ArrowUpDown, AudioLines, BookText, Gamepad2, ScanEye, Shuffle, Sparkles, Swords, Tv, Users, Zap, ZoomIn, type LucideIcon } from "lucide-react";
import type { ModuleId } from "@/engines/types";

const ICONS: Record<ModuleId, LucideIcon> = {
  "whos-that": ScanEye,
  cry: AudioLines,
  dex: BookText,
  types: Zap,
  "higher-lower": ArrowUpDown,
  games: Gamepad2,
  anime: Tv,
  competitive: Swords,
  shiny: Sparkles,
  "zoom-reveal": ZoomIn,
  "whose-team": Users,
  mixed: Shuffle,
};

export function ModeIcon({ module, className }: { module: ModuleId; className?: string }) {
  const Icon = ICONS[module];
  return <Icon className={className} aria-hidden />;
}
