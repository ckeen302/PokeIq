import { ArrowUpDown, AudioLines, BookText, ScanEye, Shuffle, Zap, type LucideIcon } from "lucide-react";
import type { ModuleId } from "@/engines/types";

const ICONS: Record<ModuleId, LucideIcon> = {
  "whos-that": ScanEye,
  cry: AudioLines,
  dex: BookText,
  types: Zap,
  "higher-lower": ArrowUpDown,
  mixed: Shuffle,
};

export function ModeIcon({ module, className }: { module: ModuleId; className?: string }) {
  const Icon = ICONS[module];
  return <Icon className={className} aria-hidden />;
}
