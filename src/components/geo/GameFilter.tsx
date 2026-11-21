"use client";

import { GEO_FILTER_MIN_PLACES, type GeoRegionInfo } from "@/lib/geo-types";
import {
  GEO_GAME_BONUS,
  allowedFamilies,
  placesFor,
  type GeoEra,
  type GeoFamilyId,
} from "@/lib/geo-families";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/catalog";
import geoSolo from "@/messages/geo-solo";
import { useGeoNames } from "@/lib/geo-i18n-client";

/** The game filter picked on the setup screen: an era (all games when unset) and, optionally, some of its game families. */
export interface FilterChoice {
  era?: GeoEra;
  families: GeoFamilyId[];
}

/** Places on a map a filter can play. */
export const filterPlaces = (region: GeoRegionInfo, filter: FilterChoice) => placesFor(region.combos, filter);

/** The families a player can name in "guess the game too": the map's, within the game's filter. */
export function gameGuessOptions(region: GeoRegionInfo, filter: FilterChoice): GeoFamilyId[] {
  const allowed = allowedFamilies(filter);
  return region.families.filter((f) => allowed.has(f));
}

const GUESS_KEY = "pokeiq:geo-guess-game";
export function readGuessGame(): boolean {
  try {
    return localStorage.getItem(GUESS_KEY) === "1";
  } catch {
    return false;
  }
}
export function rememberGuessGame(on: boolean) {
  try {
    localStorage.setItem(GUESS_KEY, on ? "1" : "0");
  } catch {
    // Private mode: it's just not remembered.
  }
}

const chip = (active: boolean, disabled = false) =>
  cn(
    "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
    active ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground",
    disabled && "cursor-not-allowed opacity-40 hover:border-border hover:text-muted-foreground"
  );

/**
 * The game filters next to the map picker: All games, Classic 2D (Red / Blue
 * to Black 2 / White 2) or Modern 3D (X / Y on, remakes included), an
 * optional pick of game families, and "guess the game too". A combination
 * with too few places on the map is off, and says why.
 */
export function GameFilter({
  region,
  filter,
  onChange,
}: {
  region: GeoRegionInfo;
  filter: FilterChoice;
  onChange: (next: FilterChoice) => void;
}) {
  const t = useT(geoSolo);
  const names = useGeoNames();
  const eras: (GeoEra | undefined)[] = [undefined, "2d", "3d"];
  const count = (era?: GeoEra, families: GeoFamilyId[] = []) => placesFor(region.combos, { era, families });
  const places = count(filter.era, filter.families);
  const tooFew = (filter.era || filter.families.length) && places < GEO_FILTER_MIN_PLACES;
  const offEras = eras.filter((e): e is GeoEra => !!e && count(e) < GEO_FILTER_MIN_PLACES);

  return (
    <div className="space-y-2" data-testid="geo-filter">
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t("filter.games")}>
        <span className="hud-label mr-1">{t("filter.games")}</span>
        {eras.map((era) => {
          const off = !!era && count(era) < GEO_FILTER_MIN_PLACES;
          return (
            <button
              key={era ?? "all"}
              type="button"
              role="radio"
              aria-checked={filter.era === era}
              disabled={off}
              title={off ? t("filter.eraOff", { era: names.era(era) }) : undefined}
              onClick={() => onChange({ era, families: [] })}
              className={chip(filter.era === era, off)}
              data-testid={`geo-era-${era ?? "all"}`}
            >
              {names.era(era ?? "all")}
            </button>
          );
        })}
      </div>


      {tooFew ? (
        <p role="note" className="text-xs text-warning" data-testid="geo-filter-note">
          {t("filter.tooFew", { n: places, map: names.map(region), from: filter.families.length ? t("filter.picked") : names.era(filter.era!), min: GEO_FILTER_MIN_PLACES })}
        </p>
      ) : (
        offEras.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {offEras.length === 1
              ? t("filter.offOne", { era: names.era(offEras[0]), map: names.map(region), min: GEO_FILTER_MIN_PLACES })
              : t("filter.offBoth", { a: names.era(offEras[0]), b: names.era(offEras[1]), map: names.map(region), min: GEO_FILTER_MIN_PLACES })}
          </p>
        )
      )}
    </div>
  );
}

/** "Guess the game too": the family picker under the mini-map, once the pin is down. */
export function GameGuessPicker({ options, value, onChange }: { options: GeoFamilyId[]; value: string | null; onChange: (id: string | null) => void }) {
  const t = useT(geoSolo);
  const names = useGeoNames();
  return (
    <label className="flex items-center gap-2 rounded-md border bg-card/95 px-2 py-1.5 text-sm backdrop-blur">
      <span className="hud-label shrink-0">{t("filter.game")}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("filter.whichAria")}
        data-testid="geo-game-pick"
      >
        <option value="">{t("filter.which", { bonus: formatNumber(GEO_GAME_BONUS, t.locale) })}</option>
        {options.map((id) => (
          <option key={id} value={id}>
            {names.family(id)}
          </option>
        ))}
      </select>
    </label>
  );
}
