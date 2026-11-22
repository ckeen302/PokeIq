import gamesEvents from "@/messages/games-events";
import gamesH2h from "@/messages/games-h2h";
import gamesInfo from "@/messages/games-info";
import gamesPickers from "@/messages/games-pickers";
import gamesShow from "@/messages/games-show";
import gamesUi from "@/messages/games-ui";
import gamesVideo from "@/messages/games-video";

/** The messages the Games' 3D view (an event, the Games) shows: its bars, the pickers, the broadcast, the video dialog. */
export const GAMES_3D_NAMESPACES = [gamesUi, gamesEvents, gamesInfo, gamesShow, gamesPickers, gamesH2h, gamesVideo];
