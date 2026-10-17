"use client";

import { useEffect, useState } from "react";
import { QuizSetup } from "@/components/quiz/QuizSetup";
import { DIFFICULTIES, type Difficulty, type ModuleId, type QuizFormat } from "@/engines/types";
import { PLAYABLE_FORMATS } from "@/lib/modes";

interface Defaults {
  format?: QuizFormat;
  difficulty?: Difficulty;
  gens?: number[];
}

/** Applies `?format=&difficulty=&gen=` overrides on top of the preset's defaults. */
function fromQuery(search: string, preset: Defaults): Defaults {
  const query = new URLSearchParams(search);
  const format = query.get("format") ?? "";
  const difficulty = query.get("difficulty") ?? "";
  const gens = (query.get("gen") ?? "")
    .split(",")
    .map(Number)
    .filter((g) => Number.isInteger(g) && g >= 1 && g <= 9);
  return {
    format: (PLAYABLE_FORMATS as readonly string[]).includes(format) ? (format as QuizFormat) : preset.format,
    difficulty: DIFFICULTIES.includes(difficulty as Difficulty) ? (difficulty as Difficulty) : preset.difficulty,
    gens: gens.length ? [...new Set(gens)].sort((a, b) => a - b) : preset.gens,
  };
}

/**
 * The landing pages are statically generated, so query overrides (deep links
 * from the coach, share cards, …) are read after mount instead of on the
 * server, which would make every quiz page dynamic.
 */
export function QuizSetupFromQuery({ module, slug, ...preset }: Defaults & { module: ModuleId; slug: string }) {
  const [settings, setSettings] = useState<{ key: string; value: Defaults } | null>(null);

  useEffect(() => {
    if (window.location.search) setSettings({ key: window.location.search, value: fromQuery(window.location.search, preset) });
    // Preset values are static per page; reading the URL once on mount is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = settings?.value ?? preset;
  return (
    <QuizSetup
      key={`${slug}${settings?.key ?? ""}`}
      module={module}
      initialFormat={value.format}
      initialDifficulty={value.difficulty}
      initialGens={value.gens}
    />
  );
}
