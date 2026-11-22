/**
 * The words painted in the venues (signs, banners, the arena's and the pool's boards, the big screen's card), in
 * English. A page in another language hands over its own (src/components/games/scene-labels.ts).
 */
export interface SceneLabels {
  games: string;
  welcome: string;
  strengthNight: string;
  liftAndWrestle: string;
  strongest: string;
  referees: string;
  weightlifting: string;
  wrestling: string;
  ceremony: string;
  swimming: string;
  fastest: string;
  aquatics: string;
  results: string;
}

export const SCENE_LABELS: SceneLabels = {
  games: "THE POKÉIQ GAMES",
  welcome: "Welcome",
  strengthNight: "STRENGTH NIGHT",
  liftAndWrestle: "WEIGHTLIFTING · WRESTLING",
  strongest: "WHO IS STRONGEST?",
  referees: "REFEREES",
  weightlifting: "Weightlifting",
  wrestling: "Wrestling",
  ceremony: "Medal ceremony",
  swimming: "Swimming",
  fastest: "WHO SWIMS FASTEST?",
  aquatics: "AQUATICS CENTRE",
  results: "Results",
};
