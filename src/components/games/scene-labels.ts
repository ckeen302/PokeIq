import type { Translator } from "@/i18n/catalog";
import type gamesShow from "@/messages/games-show";
import type { SceneLabels } from "./scene/labels";

/** The venues' words in the page's language; undefined on an English page (the scene's own English stands). */
export function sceneLabels(tr: Translator<typeof gamesShow.en>): SceneLabels | undefined {
  if (tr.locale === "en") return undefined;
  return {
    games: tr("scene.games"),
    welcome: tr("scene.welcome"),
    strengthNight: tr("scene.strengthNight"),
    liftAndWrestle: tr("scene.liftAndWrestle"),
    strongest: tr("scene.strongest"),
    referees: tr("scene.referees"),
    weightlifting: tr("scene.weightlifting"),
    wrestling: tr("scene.wrestling"),
    ceremony: tr("scene.ceremony"),
    swimming: tr("scene.swimming"),
    fastest: tr("scene.fastest"),
    aquatics: tr("scene.aquatics"),
    results: tr("scene.results"),
  };
}
