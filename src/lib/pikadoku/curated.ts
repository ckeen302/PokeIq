/**
 * Hand lists for Pikadoku categories that the data can't derive. Only entries
 * that are certain; everything else about a category is computed from data.
 * Ids are National Dex numbers (checked against the Pokédex by a test).
 */

/** Paradox Pokémon, Scarlet & Violet and the Teal Mask / Indigo Disk DLC (Bulbapedia: "Paradox Pokémon"). */
export const PARADOX_IDS: readonly number[] = [
  984, 985, 986, 987, 988, 989, 990, 991, 992, 993, 994, 995, // Great Tusk .. Iron Thorns
  1005, 1006, // Roaring Moon, Iron Valiant
  1009, 1010, // Walking Wake, Iron Leaves
  1020, 1021, 1022, 1023, // Gouging Fire, Raging Bolt, Iron Boulder, Iron Crown
];

/** Ultra Beasts, Sun & Moon / Ultra Sun & Ultra Moon (Bulbapedia: "Ultra Beast"). Necrozma is not one. */
export const ULTRA_BEAST_IDS: readonly number[] = [793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806];

/** The first-partner starters of every main-series generation, Kanto to Paldea (the first stage; their lines are derived from the data). */
export const STARTER_IDS: readonly number[] = [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912];

/**
 * Species that debuted in Pokémon Legends: Arceus, set in Hisui (they are Gen 8
 * by number, so they also count for Galar): Wyrdeer, Kleavor, Ursaluna,
 * Basculegion, Sneasler, Overqwil and Enamorus.
 */
export const HISUI_SPECIES_IDS: readonly number[] = [899, 900, 901, 902, 903, 904, 905];

/**
 * Species given a Mega Evolution in Pokémon Legends: Z-A (2025). The data has no
 * form entries for them yet, so they count for "Mega" through their species.
 * (The Mega Dimension DLC's Megas are not listed until they are confirmed here.)
 */
export const MEGA_ZA_IDS: readonly number[] = [
  36, 71, 121, 149, 154, 160, 227, 478, 500, 530, 545, 560, 604, 609, // Clefable, Victreebel, Starmie, Dragonite, Meganium, Feraligatr, Skarmory, Froslass, Emboar, Excadrill, Scolipede, Scrafty, Eelektross, Chandelure
  652, 655, 658, 668, 670, 687, 689, 691, 701, 718, 780, 870, // Chesnaught, Delphox, Greninja, Pyroar, Floette, Malamar, Barbaracle, Dragalge, Hawlucha, Zygarde, Drampa, Falinks
];
