import { useT } from "@/i18n/client";
import runNs from "@/messages/quiz-run";

/** Where a trivia answer was checked: shown after the reveal, so fans can look it up. */
export function SourceLink({ href }: { href: string }) {
  const t = useT(runNs);
  return (
    <>
      {" "}
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-screen hover:underline">
        {t("source")}
      </a>
    </>
  );
}
