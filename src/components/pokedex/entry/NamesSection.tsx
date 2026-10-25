export function NamesSection({ names }: { names: { lang: string; label: string; name: string }[] }) {
  return (
    <dl data-testid="dex-names" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {names.map((n) => (
        <div key={n.lang} className="hud rounded-lg border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{n.label}</dt>
          <dd lang={n.lang === "ja-roma" ? "ja-Latn" : n.lang} className="mt-0.5 text-base font-semibold">
            {n.name}
          </dd>
        </div>
      ))}
    </dl>
  );
}
