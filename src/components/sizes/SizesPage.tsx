import Link from "@/components/ui/PlainLink";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { DEFAULT_PRESET, PRESETS, type SizePreset } from "@/lib/sizes/presets";
import { COMPARE_PATH, itemPath, presetPath } from "@/lib/sizes/deeplink";
import { factFor } from "@/lib/sizes/facts";
import { everythingLine, listItems, listOrder, listRows, type ListSpec } from "@/lib/sizes/list";
import { HEIGHT_ORDER, orderTag, withOrder, type Order } from "@/lib/sizes/order";
import { formatFeet, formatMetres, type SizeItem } from "@/lib/sizes/types";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { BackButton } from "@/components/ui/BackButton";
import { SizesExperience } from "./SizesExperience";
import { SizesList } from "./SizesList";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { cn } from "@/lib/utils";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import { formatNumber, type Translator } from "@/i18n/catalog";
import sizesPages from "@/messages/sizes-pages";
import sizesLines from "@/messages/sizes-lines";
import sizes3d from "@/messages/sizes-3d";
import { pageItems, pageLocal } from "./local";
import { factText, listCaptionText, listNoteText, presetLabel, sizeText as localSize, tagText } from "./words";

type L = Translator<typeof sizesLines.en>;

/** The species' Pokédex page for any form ("charizard-gmax" → "charizard"). */
export function pokedexSlug(i: SizeItem): string {
  return i.kind === "pokemon" ? i.key : getPokemon(i.species)?.slug ?? i.key;
}

/** "1.7 m (5 ft 7 in)" on English pages; the size alone, metric, in another language. */
const sizeText = (i: SizeItem, t: L) => (t.locale === "en" ? `${formatMetres(i.m)}${i.min ? "+" : ""} (${formatFeet(i.m)}${i.min ? "+" : ""})` : localSize(i, t));

/**
 * /pokedex/sizes, a preset's page, a Pokémon's own size page and a
 * comparison: the 3D experience over the server-rendered table, both in the
 * address's order (?by=speed&dir=desc; Height, smallest first, without one).
 */
export function SizesPage({ preset = DEFAULT_PRESET, focus: focusEn, vs: vsEn, compare = false, order: asked = HEIGHT_ORDER }: { preset?: SizePreset; focus?: SizeItem; vs?: SizeItem[]; compare?: boolean; order?: Order }) {
  const t = serverT(sizesPages);
  const tl = serverT(sizesLines);
  // In another language every figure carries its name there (English pages: the data's own items).
  const SIZE_ITEMS = pageItems();
  const local = pageLocal();
  const byKey = local ? new Map(SIZE_ITEMS.map((i) => [i.key, i])) : null;
  const focus = focusEn && byKey ? byKey.get(focusEn.key) ?? focusEn : focusEn;
  const vs = vsEn && byKey ? vsEn.map((i) => byKey.get(i.key) ?? i) : vsEn;
  const comparing = !!vs && vs.length >= 2;
  const spec: ListSpec = { preset: preset.id, focus: focus?.key ?? null, vs: comparing ? vs.map((i) => i.key) : [] };
  // A Pokémon's own page in an order it has no value in (a Gigantamax form by weight) stands by height.
  const order = listOrder(SIZE_ITEMS, spec, asked);
  const rows = listItems(SIZE_ITEMS, spec, order);
  const mons = rows.filter((i) => i.kind !== "ref");
  const caption = listCaptionText(SIZE_ITEMS, spec, order, tl);
  const path = comparing ? COMPARE_PATH : focus ? itemPath(focus.key) : compare ? COMPARE_PATH : presetPath(preset.id);
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: caption,
    url: `${SITE_URL}${withOrder(focus ? itemPath(focus.key) : presetPath(preset.id), order)}`,
    numberOfItems: mons.length,
    ...(mons.length <= 160 && { itemListElement: mons.map((i, n) => ({ "@type": "ListItem", position: n + 1, name: `${i.name} (${(local ? tagText(i, order, tl) : orderTag(i, order)) ?? (local ? localSize({ m: i.m, min: false }, tl) : formatMetres(i.m))})`, url: `${SITE_URL}${itemPath(i.key)}` })) }),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ClientMessages namespaces={[sizesLines, sizes3d]}>
      <SizesExperience preset={preset.id} focus={focus?.key ?? null} vs={spec.vs} compare={compare} order={order} {...(local && { local })}>
        <div className="space-y-6">
          {comparing ? (
            <CompareHeader items={vs} t={t} tl={tl} />
          ) : focus ? (
            <FocusHeader item={focus} all={SIZE_ITEMS} t={t} tl={tl} />
          ) : preset.id === DEFAULT_PRESET.id ? (
            <ListHeader
              kicker={t("main.kicker")}
              title={t("main.title")}
              accent={t("main.accent")}
              blurb={t("main.blurb")}
            />
          ) : (
            <ListHeader kicker={t("preset.kicker")} title={t("preset.title", { label: presetLabel(preset.id, tl) })} accent={t("preset.accent")} blurb={t(`blurbs.${preset.id as BlurbId}`)} />
          )}
          <nav aria-label={t("nav.lineups")} className="flex flex-wrap justify-center gap-2">
            {PRESETS.map((p) => (
              <Link
                key={p.id}
                href={withOrder(presetPath(p.id), order)}
                prefetch={false}
                className={cn("tap rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors", !focus && !comparing && p.id === preset.id ? "border-primary/60 text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {presetLabel(p.id, tl)}
              </Link>
            ))}
            <Link href={COMPARE_PATH} prefetch={false} className="tap rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
              {t("nav.compare")}
            </Link>
          </nav>
          <SizesList rows={listRows(rows, SIZE_ITEMS)} focus={focus?.key} caption={caption} note={listNoteText(SIZE_ITEMS, spec, order, tl)} spec={spec} order={order} path={path} />
          <p className="text-center text-xs text-muted-foreground">
            {t("footer")}
          </p>
        </div>
      </SizesExperience>
      </ClientMessages>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
    </div>
  );
}

type P = Translator<typeof sizesPages.en>;
type BlurbId = keyof typeof sizesPages.en.blurbs;

function FocusHeader({ item, all, t, tl }: { item: SizeItem; all: SizeItem[]; t: P; tl: L }) {
  const line = everythingLine(all);
  const fact = tl.locale === "en" ? factFor(item, line) : factText(item, line, tl);
  return (
    <div className="space-y-3 text-center">
      <div className="text-left">
        <BackButton href="/pokedex/sizes" label={t("focus.back")} />
      </div>
      <p className="hud-label text-screen">
        <Link href="/pokedex/sizes" className="hover:text-foreground">{t("focus.sizes")}</Link> · #{String(item.species).padStart(4, "0")}{item.kind !== "pokemon" ? ` · ${tl(`kind.${item.kind}`)}` : ""}
      </p>
      <h1 className="break-words font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{t("focus.title", { name: item.name })}</h1>
      <p className="text-lg">
        <span className="font-display font-bold">{sizeText(item, tl)}</span> <span className="text-muted-foreground">{t(item.length ? "focus.length" : "focus.height")}</span>
        {item.kg != null && <span className="text-muted-foreground">{t("focus.kg", { kg: tl.locale === "en" ? item.kg.toLocaleString("en-US") : formatNumber(item.kg, tl.locale) })}</span>}
      </p>
      {fact && <p className="mx-auto max-w-2xl text-muted-foreground">{fact}.</p>}
      <p className="text-sm">
        <Link href={`/pokemon/${pokedexSlug(item)}`} className="text-primary underline-offset-2 hover:underline">{t("focus.entry", { name: item.name })}</Link>
      </p>
    </div>
  );
}

function CompareHeader({ items, t, tl }: { items: SizeItem[]; t: P; tl: L }) {
  return (
    <div className="space-y-3 text-center">
      <div className="text-left">
        <BackButton href="/pokedex/sizes" label={t("focus.back")} />
      </div>
      <p className="hud-label text-screen">{t("compare.kicker")}</p>
      <h1 className="break-words font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{items.map((i) => i.name).join(tl("compare.sep"))}</h1>
      <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
        {items.map((i) => (
          <span key={i.key}>
            <Link href={itemPath(i.key)} className="font-semibold hover:text-primary">{i.name}</Link> <span className="text-muted-foreground">{sizeText(i, tl)}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
