/**
 * Notable trainers: Gym Leaders, Elite Four, Champions, rivals and villain
 * leaders/admins. Descriptions are our own short summaries. Specialty types
 * and badges match the sourced gym list (src/data/quiz/games/gyms.json).
 * Client safe. Teams are linked to a notable at import time (notableFor).
 */

export type NotableRole = "Gym Leader" | "Elite Four" | "Champion" | "Rival" | "Villain" | "Admin" | "Trainer";

export interface NotableTrainer {
  slug: string;
  name: string;
  role: NotableRole;
  /** Extra roles the same person holds in other games ("Elite Four" for Koga). */
  alsoRoles?: NotableRole[];
  region: string;
  /** Specialty type, when the trainer has one. */
  type?: string;
  badge?: string;
  blurb: string;
  /** Names the decompilations print for them (Gen I generic classes print the name as the class). */
  names: string[];
  /** Printed classes a named team must have to count (keeps "Bird Keeper Will" off Will's page). */
  cls?: RegExp;
  /** Unnamed teams (player-named rivals) matched by class constant, per game. */
  consts?: Partial<Record<string, RegExp>>;
}

const LEADER = /^Leader$/;
const E4 = /^Elite Four$/;

const N = (n: NotableTrainer) => n;

export const NOTABLE: NotableTrainer[] = [
  // Kanto Gym Leaders
  N({ slug: "brock", name: "Brock", role: "Gym Leader", region: "Kanto", type: "Rock", badge: "Boulder Badge", names: ["Brock"], cls: LEADER, blurb: "Pewter City's Gym Leader and, for most players, the first real test of a Kanto journey. His sturdy Rock-type team punishes anyone who leans on Normal or Fire attacks, so a Water or Grass partner makes the climb much easier." }),
  N({ slug: "misty", name: "Misty", role: "Gym Leader", region: "Kanto", type: "Water", badge: "Cascade Badge", names: ["Misty"], cls: LEADER, blurb: "The Cerulean City Gym Leader, who battles with fast, hard-hitting Water types. Her Starmie is the classic early-game wall, and it rewards bringing an Electric or Grass type to the pool." }),
  N({ slug: "lt-surge", name: "Lt. Surge", role: "Gym Leader", region: "Kanto", type: "Electric", badge: "Thunder Badge", names: ["Lt. Surge"], cls: LEADER, blurb: "Vermilion City's Gym Leader, a soldier who swears by Electric types. In the original games you reach him through a trash-can switch puzzle; a Ground type shuts most of his team down." }),
  N({ slug: "erika", name: "Erika", role: "Gym Leader", region: "Kanto", type: "Grass", badge: "Rainbow Badge", names: ["Erika"], cls: LEADER, blurb: "The calm Gym Leader of Celadon City, whose Grass types lean on status moves and draining attacks. Fire, Ice, Flying and Poison moves all find easy openings against her garden-themed Gym." }),
  N({ slug: "koga", name: "Koga", role: "Gym Leader", alsoRoles: ["Elite Four"], region: "Kanto", type: "Poison", badge: "Soul Badge", names: ["Koga"], cls: /^(Leader|Elite Four)$/, blurb: "A ninja who runs the Fuchsia City Gym, hidden behind invisible walls, in the Kanto games. By Gold and Silver he has joined the Elite Four, still using Poison types that wear opponents down with status and evasion tricks." }),
  N({ slug: "sabrina", name: "Sabrina", role: "Gym Leader", region: "Kanto", type: "Psychic", badge: "Marsh Badge", names: ["Sabrina"], cls: LEADER, blurb: "Saffron City's Gym Leader and a powerful psychic, whose Gym is a maze of teleport pads. Her Psychic types were among the strongest in the first generation, when few types could hit them hard." }),
  N({ slug: "blaine", name: "Blaine", role: "Gym Leader", region: "Kanto", type: "Fire", badge: "Volcano Badge", names: ["Blaine"], cls: LEADER, blurb: "The quiz-loving Gym Leader of Cinnabar Island, who tests challengers with trivia before battling with Fire types. After the volcano erupts in Gold and Silver he relocates his Gym to the Seafoam Islands." }),
  N({ slug: "giovanni", name: "Giovanni", role: "Villain", alsoRoles: ["Gym Leader"], region: "Kanto", type: "Ground", badge: "Earth Badge", names: ["Giovanni"], cls: /^(Giovanni|Leader|Boss|Rocket Boss)$/, blurb: "The boss of Team Rocket, who is secretly also the Viridian City Gym Leader. You face him in the Rocket Hideout and Silph Co. before he finally battles you with Ground types for the last Kanto badge." }),
  N({ slug: "janine", name: "Janine", role: "Gym Leader", region: "Kanto", type: "Poison", badge: "Soul Badge", names: ["Janine"], cls: LEADER, blurb: "Koga's daughter, who takes over the Fuchsia City Gym once he joins the Elite Four. She keeps her father's Poison-type style and his habit of hiding behind look-alike trainers." }),
  N({ slug: "blue", name: "Blue", role: "Rival", alsoRoles: ["Champion", "Gym Leader"], region: "Kanto", names: ["Blue"], cls: LEADER, consts: { "red-blue": /^RIVAL\d$/, yellow: /^RIVAL\d$/, "firered-leafgreen": /^TRAINER_CLASS_(RIVAL_EARLY|RIVAL_LATE|CHAMPION)$/ }, blurb: "Professor Oak's grandson and the player's rival in Kanto, whose name the player chooses (Blue is his usual name). He races ahead of you all game and reaches the Champion's seat first; in the Johto games he leads the Viridian City Gym instead." }),

  // Johto Gym Leaders
  N({ slug: "falkner", name: "Falkner", role: "Gym Leader", region: "Johto", type: "Flying", badge: "Zephyr Badge", names: ["Falkner"], cls: LEADER, blurb: "Violet City's Gym Leader and the first in Johto, who inherited his love of bird Pokémon from his father. His Pidgeotto is the first strong opponent most players meet in the region." }),
  N({ slug: "bugsy", name: "Bugsy", role: "Gym Leader", region: "Johto", type: "Bug", badge: "Hive Badge", names: ["Bugsy"], cls: LEADER, blurb: "Azalea Town's young Gym Leader and a self-described Bug Pokémon researcher. His Scyther, with Fury Cutter, can sweep an unprepared team, so Fire and Flying moves are worth having ready." }),
  N({ slug: "whitney", name: "Whitney", role: "Gym Leader", region: "Johto", type: "Normal", badge: "Plain Badge", names: ["Whitney"], cls: LEADER, blurb: "The Goldenrod City Gym Leader, famous for a Miltank that rolls over challengers with Rollout and heals with Milk Drink. After losing she cries until you are given the badge." }),
  N({ slug: "morty", name: "Morty", role: "Gym Leader", region: "Johto", type: "Ghost", badge: "Fog Badge", names: ["Morty"], cls: LEADER, blurb: "Ecruteak City's Gym Leader, a mystic who trains Ghost types and studies the legends of the city's towers. His Gengar line can't be touched by Normal or Fighting attacks." }),
  N({ slug: "chuck", name: "Chuck", role: "Gym Leader", region: "Johto", type: "Fighting", badge: "Storm Badge", names: ["Chuck"], cls: LEADER, blurb: "Cianwood City's Gym Leader, a martial artist who trains under a waterfall with his Fighting types. Psychic and Flying attacks are the usual answer to his Poliwrath." }),
  N({ slug: "jasmine", name: "Jasmine", role: "Gym Leader", region: "Johto", type: "Steel", badge: "Mineral Badge", names: ["Jasmine"], cls: LEADER, blurb: "Olivine City's gentle Gym Leader, who won't battle until the sick Ampharos at the lighthouse is cured. Her Steelix shrugs off most attacks but folds to Fire, Ground and Fighting moves." }),
  N({ slug: "pryce", name: "Pryce", role: "Gym Leader", region: "Johto", type: "Ice", badge: "Glacier Badge", names: ["Pryce"], cls: LEADER, blurb: "The veteran Gym Leader of Mahogany Town, who has trained Ice types for decades. His Gym floor is a sliding-ice puzzle, and his Piloswine adds Ground moves to the cold." }),
  N({ slug: "clair", name: "Clair", role: "Gym Leader", region: "Johto", type: "Dragon", badge: "Rising Badge", names: ["Clair"], cls: LEADER, blurb: "Blackthorn City's proud Gym Leader and Lance's cousin, who trains Dragon types. She refuses to hand over her badge until you pass a trial in the Dragon's Den, and her Kingdra has very few weaknesses." }),

  // Hoenn Gym Leaders
  N({ slug: "roxanne", name: "Roxanne", role: "Gym Leader", region: "Hoenn", type: "Rock", badge: "Stone Badge", names: ["Roxanne"], cls: LEADER, blurb: "Rustboro City's Gym Leader and the first in Hoenn, a studious trainer who favours Rock types. Her team, topped by Nosepass, is weak to the Grass and Water starters." }),
  N({ slug: "brawly", name: "Brawly", role: "Gym Leader", region: "Hoenn", type: "Fighting", badge: "Knuckle Badge", names: ["Brawly"], cls: LEADER, blurb: "Dewford Town's surfing Gym Leader, who runs a dark Gym that brightens as you beat his trainers. His Makuhita hits hard, so Flying and Psychic types are the safe picks." }),
  N({ slug: "wattson", name: "Wattson", role: "Gym Leader", region: "Hoenn", type: "Electric", badge: "Dynamo Badge", names: ["Wattson"], cls: LEADER, blurb: "Mauville City's jolly, laughing Gym Leader, whose Gym is wired with electric barriers. Ground types make his Electric team almost harmless." }),
  N({ slug: "flannery", name: "Flannery", role: "Gym Leader", region: "Hoenn", type: "Fire", badge: "Heat Badge", names: ["Flannery"], cls: LEADER, blurb: "Lavaridge Town's newly appointed Gym Leader, eager to live up to her grandfather. Her Fire types, topped by Torkoal, burn through Grass and Bug teams." }),
  N({ slug: "norman", name: "Norman", role: "Gym Leader", region: "Hoenn", type: "Normal", badge: "Balance Badge", names: ["Norman"], cls: LEADER, blurb: "The player's father and the Petalburg City Gym Leader, who only battles you after four badges. His Slaking is enormously strong but can only attack every other turn." }),
  N({ slug: "winona", name: "Winona", role: "Gym Leader", region: "Hoenn", type: "Flying", badge: "Feather Badge", names: ["Winona"], cls: LEADER, blurb: "Fortree City's Gym Leader, who soars with Flying types from a Gym full of turnstiles. Her Altaria, part Dragon, is the one to plan for." }),
  N({ slug: "tate-and-liza", name: "Tate & Liza", role: "Gym Leader", region: "Hoenn", type: "Psychic", badge: "Mind Badge", names: ["Tate & Liza"], cls: LEADER, blurb: "Twin Gym Leaders of Mossdeep City who fight together in a Double Battle. Their Psychic types, including Solrock and Lunatone, rely on teamwork between the two sides of the field." }),
  N({ slug: "wallace", name: "Wallace", role: "Gym Leader", alsoRoles: ["Champion"], region: "Hoenn", type: "Water", badge: "Rain Badge", names: ["Wallace"], cls: /^(Leader|Champion)$/, blurb: "An elegant Water-type master who leads the Sootopolis City Gym in Ruby and Sapphire. In Emerald he has become the Hoenn Champion, still closing out battles with his Milotic." }),
  N({ slug: "juan", name: "Juan", role: "Gym Leader", region: "Hoenn", type: "Water", badge: "Rain Badge", names: ["Juan"], cls: LEADER, blurb: "Wallace's mentor, who takes over the Sootopolis City Gym in Emerald. He battles with graceful Water types, and his Kingdra has very few weaknesses." }),

  // Sinnoh Gym Leaders
  N({ slug: "roark", name: "Roark", role: "Gym Leader", region: "Sinnoh", type: "Rock", badge: "Coal Badge", names: ["Roark"], cls: LEADER, blurb: "Oreburgh City's Gym Leader, who also works in the coal mine and digs for fossils. His Cranidos hits much harder than anything else at that point in the game." }),
  N({ slug: "gardenia", name: "Gardenia", role: "Gym Leader", region: "Sinnoh", type: "Grass", badge: "Forest Badge", names: ["Gardenia"], cls: LEADER, blurb: "The cheerful Gym Leader of Eterna City, who adores Grass types. Her Roserade is the strongest Pokémon on her team, so Fire, Flying and Psychic moves are worth bringing." }),
  N({ slug: "maylene", name: "Maylene", role: "Gym Leader", region: "Sinnoh", type: "Fighting", badge: "Cobble Badge", names: ["Maylene"], cls: LEADER, blurb: "Veilstone City's young Gym Leader, a martial artist who doubts she deserves the title until you battle her. Her Lucario is the centrepiece of her Fighting-type team." }),
  N({ slug: "crasher-wake", name: "Crasher Wake", role: "Gym Leader", region: "Sinnoh", type: "Water", badge: "Fen Badge", names: ["Wake"], cls: LEADER, blurb: "Pastoria City's masked Gym Leader, a showman who wrestles with his Water types. His Floatzel and Gyarados reward bringing Electric or Grass attacks." }),
  N({ slug: "fantina", name: "Fantina", role: "Gym Leader", region: "Sinnoh", type: "Ghost", badge: "Relic Badge", names: ["Fantina"], cls: LEADER, blurb: "Hearthome City's flamboyant Gym Leader, who also loves Pokémon Contests. Her Ghost types, led by Mismagius, ignore Normal and Fighting attacks." }),
  N({ slug: "byron", name: "Byron", role: "Gym Leader", region: "Sinnoh", type: "Steel", badge: "Mine Badge", names: ["Byron"], cls: LEADER, blurb: "Roark's father and the Canalave City Gym Leader, a booming miner who trains Steel types. His Bastiodon is a near-impenetrable wall to anything but Fighting, Ground and Water moves." }),
  N({ slug: "candice", name: "Candice", role: "Gym Leader", region: "Sinnoh", type: "Ice", badge: "Icicle Badge", names: ["Candice"], cls: LEADER, blurb: "Snowpoint City's energetic Gym Leader, who talks constantly about focus. Her Ice types, including Abomasnow and its hail, hit Dragon and Grass teams hard." }),
  N({ slug: "volkner", name: "Volkner", role: "Gym Leader", region: "Sinnoh", type: "Electric", badge: "Beacon Badge", names: ["Volkner"], cls: LEADER, blurb: "Sunyshore City's Gym Leader and the last in Sinnoh, bored by how easily he wins until you arrive. His Electivire and Luxray are the main threats, and Ground types are the best answer." }),

  // Elite Four
  N({ slug: "lorelei", name: "Lorelei", role: "Elite Four", region: "Kanto", type: "Ice", names: ["Lorelei"], cls: E4, blurb: "The first member of the Kanto Elite Four, an Ice-type specialist. Her Lapras and Cloyster cover many weaknesses, so Electric and Fighting moves pay off." }),
  N({ slug: "bruno", name: "Bruno", role: "Elite Four", region: "Kanto", type: "Fighting", names: ["Bruno"], cls: E4, blurb: "A martial artist of the Elite Four, in Kanto and again in Johto, who trains with his Fighting types. His Onix carry Rock and Ground coverage, so Psychic types alone aren't enough." }),
  N({ slug: "agatha", name: "Agatha", role: "Elite Four", region: "Kanto", type: "Ghost", names: ["Agatha"], cls: E4, blurb: "A veteran Ghost-type trainer of the Kanto Elite Four and an old rival of Professor Oak. Her Gengar line relies on sleep and confusion to slow challengers down." }),
  N({ slug: "lance", name: "Lance", role: "Champion", alsoRoles: ["Elite Four"], region: "Kanto", type: "Dragon", names: ["Lance"], cls: /^(Lance|Elite Four|Champion|Pokémon Trainer)$/, blurb: "A Dragon-type master who is the last of the Kanto Elite Four in the first generation and the Champion of the Indigo Plateau in the Johto games. His Dragonite are the toughest part of his team; Ice moves hit them hardest." }),
  N({ slug: "will", name: "Will", role: "Elite Four", region: "Johto", type: "Psychic", names: ["Will"], cls: E4, blurb: "The masked first member of the Johto Elite Four, who trains Psychic types. His Xatu and Exeggutor can be handled with Dark, Bug and Ghost moves." }),
  N({ slug: "karen", name: "Karen", role: "Elite Four", region: "Johto", type: "Dark", names: ["Karen"], cls: E4, blurb: "The last member of the Johto Elite Four, who uses Dark types and believes strong trainers should use their favourite Pokémon. Fighting and Bug moves cut through most of her team." }),
  N({ slug: "sidney", name: "Sidney", role: "Elite Four", region: "Hoenn", type: "Dark", names: ["Sidney"], cls: E4, blurb: "The first of Hoenn's Elite Four, a cocky Dark-type trainer. His Absol hits hard, so Fighting and Bug attacks are the quickest route through." }),
  N({ slug: "phoebe", name: "Phoebe", role: "Elite Four", region: "Hoenn", type: "Ghost", names: ["Phoebe"], cls: E4, blurb: "A cheerful Ghost-type trainer of the Hoenn Elite Four who trained on Mt. Pyre. Her Dusclops are slow but very sturdy." }),
  N({ slug: "glacia", name: "Glacia", role: "Elite Four", region: "Hoenn", type: "Ice", names: ["Glacia"], cls: E4, blurb: "An Ice-type trainer of the Hoenn Elite Four who travelled to Hoenn looking for strong opponents. Her Walrein and Glalie cover each other well." }),
  N({ slug: "drake", name: "Drake", role: "Elite Four", region: "Hoenn", type: "Dragon", names: ["Drake"], cls: E4, blurb: "The last of the Hoenn Elite Four, a gruff veteran who trains Dragon types. His Salamence is the main threat and is weak to Ice moves." }),
  N({ slug: "aaron", name: "Aaron", role: "Elite Four", region: "Sinnoh", type: "Bug", names: ["Aaron"], cls: E4, blurb: "The first of Sinnoh's Elite Four, a young trainer devoted to Bug types. His Drapion stands out on his team, so a strong Ground move is useful." }),
  N({ slug: "bertha", name: "Bertha", role: "Elite Four", region: "Sinnoh", type: "Ground", names: ["Bertha"], cls: E4, blurb: "A kindly Ground-type specialist of the Sinnoh Elite Four. Water and Grass attacks deal with most of her team." }),
  N({ slug: "flint", name: "Flint", role: "Elite Four", region: "Sinnoh", type: "Fire", names: ["Flint"], cls: E4, blurb: "A fiery member of the Sinnoh Elite Four and Volkner's close friend. He trains Fire types, so Water, Ground and Rock moves serve you well." }),
  N({ slug: "lucian", name: "Lucian", role: "Elite Four", region: "Sinnoh", type: "Psychic", names: ["Lucian"], cls: E4, blurb: "The last of the Sinnoh Elite Four, a calm reader who trains Psychic types. Dark, Ghost and Bug moves are the best way past his team." }),

  // Champions
  N({ slug: "steven", name: "Steven", role: "Champion", region: "Hoenn", type: "Steel", names: ["Steven"], cls: /^(Champion|Pokémon Trainer)$/, blurb: "The son of the Devon Corporation's president and a keen collector of rare stones. He is the Hoenn Champion in Ruby and Sapphire, and a post-game challenge waiting in Meteor Falls in Emerald." }),
  N({ slug: "cynthia", name: "Cynthia", role: "Champion", region: "Sinnoh", names: ["Cynthia"], cls: /^Champion$/, blurb: "The Sinnoh Champion, who studies the region's myths between battles. Her balanced team is led by Garchomp, one of the most feared final opponents in the series." }),

  // Other rivals
  N({ slug: "red", name: "Red", role: "Trainer", region: "Kanto", names: ["Red"], cls: /^Pokémon Trainer$/, blurb: "The silent hero of the Kanto games, who waits at the top of Mt. Silver in the Johto games. Beating him is the final battle of Gold, Silver, Crystal, HeartGold and SoulSilver." }),
  N({ slug: "silver", name: "Silver", role: "Rival", region: "Johto", names: [], consts: { "gold-silver": /^RIVAL\d$/, crystal: /^RIVAL\d$/, "heartgold-soulsilver": /^TRAINERCLASS_RIVAL$/ }, blurb: "The red-haired rival of the Johto games, named by the player (Silver is the usual name), who steals a starter from Professor Elm's lab. He starts out cruel to his Pokémon and slowly learns to value them over the course of the story." }),
  N({ slug: "may", name: "May", role: "Rival", region: "Hoenn", names: ["May"], cls: /^Pokémon Trainer$/, blurb: "Professor Birch's daughter and a friendly rival in Hoenn when the player chooses to be Brendan. She picks the starter that has the advantage over yours and battles you several times on the road." }),
  N({ slug: "brendan", name: "Brendan", role: "Rival", region: "Hoenn", names: ["Brendan"], cls: /^Pokémon Trainer$/, blurb: "Professor Birch's son and a friendly rival in Hoenn when the player chooses to be May. Like May, he takes the starter that beats yours and checks your progress along the way." }),
  N({ slug: "wally", name: "Wally", role: "Rival", region: "Hoenn", names: ["Wally"], cls: /^Pokémon Trainer$/, blurb: "A frail boy you help catch his first Pokémon, a Ralts, early in the Hoenn games. He grows into a serious trainer and waits for you at Victory Road as one of the last tests before the League." }),
  N({ slug: "barry", name: "Barry", role: "Rival", region: "Sinnoh", names: [], consts: { platinum: /^TRAINER_CLASS_RIVAL$/ }, blurb: "The player's impatient best friend in Sinnoh, named by the player (Barry is the default), who threatens to fine anyone who slows him down. He takes the starter with the type advantage and battles you throughout the journey." }),

  // Villains and admins
  N({ slug: "archie", name: "Archie", role: "Villain", region: "Hoenn", names: ["Archie"], cls: /^Aqua Leader$/, blurb: "The leader of Team Aqua, who wants to expand the seas by awakening Kyogre. He is the main villain of Sapphire, and in Emerald his team and Team Magma both stand in your way." }),
  N({ slug: "maxie", name: "Maxie", role: "Villain", region: "Hoenn", names: ["Maxie"], cls: /^Magma Leader$/, blurb: "The leader of Team Magma, who plans to expand the land by awakening Groudon. He is the main villain of Ruby and one of two villain bosses in Emerald." }),
  N({ slug: "matt", name: "Matt", role: "Admin", region: "Hoenn", names: ["Matt"], cls: /^Aqua Admin$/, blurb: "A loud, boisterous Team Aqua Admin who serves under Archie. You battle him as Team Aqua carries out its plans across Hoenn." }),
  N({ slug: "shelly", name: "Shelly", role: "Admin", region: "Hoenn", names: ["Shelly"], cls: /^Aqua Admin$/, blurb: "A Team Aqua Admin who carries out the team's plans at the Weather Institute and, in Sapphire, the Seafloor Cavern." }),
  N({ slug: "tabitha", name: "Tabitha", role: "Admin", region: "Hoenn", names: ["Tabitha"], cls: /^Magma Admin$/, blurb: "A Team Magma Admin and one of Maxie's loyal deputies, faced at Mt. Chimney and in Team Magma's hideout." }),
  N({ slug: "courtney", name: "Courtney", role: "Admin", region: "Hoenn", names: ["Courtney"], cls: /^Magma Admin$/, blurb: "A quiet Team Magma Admin who leads the team's operations at the Weather Institute and the Seafloor Cavern in Ruby." }),
  N({ slug: "cyrus", name: "Cyrus", role: "Villain", region: "Sinnoh", names: ["Cyrus"], cls: /^Galactic Boss$/, blurb: "The cold leader of Team Galactic, who wants to remake the universe without spirit by controlling Dialga and Palkia. You battle him at Galactic HQ, at Spear Pillar and, in Platinum, inside the Distortion World." }),
  N({ slug: "mars", name: "Mars", role: "Admin", region: "Sinnoh", names: ["Mars"], cls: /^Commander$/, blurb: "A Team Galactic Commander, met at the Valley Windworks and several times after. Her Purugly and Bronzor are the core of her team." }),
  N({ slug: "jupiter", name: "Jupiter", role: "Admin", region: "Sinnoh", names: ["Jupiter"], cls: /^Commander$/, blurb: "A Team Galactic Commander who runs the team's Eterna City building and later the attack on Lake Acuity's guardian. Her Skuntank is her strongest partner." }),
  N({ slug: "saturn", name: "Saturn", role: "Admin", region: "Sinnoh", names: ["Saturn"], cls: /^Commander$/, blurb: "A composed Team Galactic Commander who leads the raid on Lake Valor and guards Galactic HQ. He battles with Toxicroak, Bronzor and Kadabra." }),
  N({ slug: "archer", name: "Archer", role: "Admin", region: "Johto", names: ["Archer"], cls: /^Executive$/, blurb: "The Team Rocket Executive who takes charge while Giovanni is gone in HeartGold and SoulSilver. He leads the Radio Tower takeover and battles with Houndoom and other Dark and Poison types." }),
  N({ slug: "ariana", name: "Ariana", role: "Admin", region: "Johto", names: ["Ariana"], cls: /^Executive$/, blurb: "A Team Rocket Executive in HeartGold and SoulSilver, met in the Mahogany Town hideout and at the Radio Tower. Her Arbok and Vileplume lean on poison." }),
  N({ slug: "proton", name: "Proton", role: "Admin", region: "Johto", names: ["Proton"], cls: /^Executive$/, blurb: "A ruthless Team Rocket Executive in HeartGold and SoulSilver, first faced at the Slowpoke Well. He fights with Poison types such as Zubat and Koffing." }),
  N({ slug: "petrel", name: "Petrel", role: "Admin", region: "Johto", names: ["Petrel"], cls: /^Executive$/, blurb: "A Team Rocket Executive and master of disguise in HeartGold and SoulSilver, who poses as the Radio Director. His team is built around Koffing and Weezing." }),
];

const BY_SLUG = new Map(NOTABLE.map((n) => [n.slug, n]));
export const notable = (slug: string) => BY_SLUG.get(slug);

/** Which notable a team belongs to (by name and printed class, or by class constant for player-named rivals). */
export function notableFor(game: string, clsConst: string, name: string | undefined, cls?: string): string | undefined {
  for (const n of NOTABLE) {
    const re = n.consts?.[game];
    if (re && re.test(clsConst)) return n.slug;
  }
  for (const n of NOTABLE) {
    if (name && n.names.includes(name) && (!n.cls || (cls !== undefined && n.cls.test(cls)))) return n.slug;
    // Gen I prints the leader's name as the class ("Brock"), with no personal name.
    if (!name && cls && n.names.includes(cls)) return n.slug;
  }
  return undefined;
}

export const ROLE_ORDER: NotableRole[] = ["Gym Leader", "Elite Four", "Champion", "Rival", "Trainer", "Villain", "Admin"];
