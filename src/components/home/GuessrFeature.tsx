import Link from "next/link";
import { ArrowRight, Compass, Flame, Swords } from "lucide-react";
import { geoRegions } from "@/lib/server/geo";
import { WORLD_REGION } from "@/lib/geo-types";

/** Home-page spotlight for PokéGuessr: a real in-game view behind the pitch. */
export function GuessrFeature() {
  const preview = geoRegions().find((r) => r.id === WORLD_REGION)?.previews.classic;
  return (
    <Link
      href="/guessr"
      className="group relative block overflow-hidden rounded-xl border border-success/30 bg-card transition-colors hover:border-success/60"
    >
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- CDN-cached screenshot behind the text
        <img
          src={preview}
          alt=""
          className="absolute inset-0 h-full w-full scale-[1.07] object-cover opacity-45 transition-transform duration-700 group-hover:scale-[1.12]"
        />
      )}
      <div className="dark-scope absolute inset-0 bg-gradient-to-r from-[hsl(250_45%_6%)] via-[hsl(250_45%_6%/0.85)] to-transparent" aria-hidden />
      <div className="dark-scope relative grid gap-6 p-6 sm:p-10 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <p className="hud-label flex items-center gap-2 text-success">
            <span className="led h-1.5 w-1.5 animate-blink text-success" /> New · PokéGuessr
          </p>
          <h2 className="font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl">
            Where in the world
            <br />
            <span className="text-success [text-shadow:0_0_28px_hsl(var(--success)/0.45)]">is this?</span>
          </h2>
          <p className="max-w-md text-muted-foreground">
            GeoGuessr for Pokémon. Real in-game views, a pin on the map, up to 25,000 points. New daily game every day.
          </p>
          <span className="inline-flex items-center gap-2 rounded-md bg-success px-5 py-3 font-display text-sm font-bold uppercase tracking-wider text-success-foreground shadow-[0_4px_0_hsl(154_60%_24%)] transition-transform group-hover:-translate-y-0.5">
            <Compass className="h-4 w-4" aria-hidden /> Play PokéGuessr
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </span>
        </div>
        <ul className="flex flex-col justify-end gap-2 text-sm">
          {[
            { icon: Compass, text: "Every region from Kanto to Paldea, on one world map" },
            { icon: Swords, text: "Challenge friends to the same five places" },
            { icon: Flame, text: "Streak mode: one miss and it's over" },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2 rounded-md border border-foreground/10 bg-black/30 px-3 py-2 backdrop-blur">
              <Icon className="h-4 w-4 shrink-0 text-success" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </div>
    </Link>
  );
}
