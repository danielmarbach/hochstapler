import type { Theme } from "../theme-types.ts";
import { BOARD_SIZE } from "../types.ts";
import { FR_SECURITIES } from "./securities.ts";

const streets = [
  // G0 Lille
  "Rue Esquermoise",
  "Grand’Place Lille",
  // G1 Strasbourg
  "Petite France",
  "Rue des Hallebardes",
  "Place Kléber",
  // G2 Bordeaux
  "Rue Sainte-Catherine",
  "Cours de l’Intendance",
  "Place de la Bourse",
  // G3 Lyon
  "Vieux Lyon",
  "Place des Terreaux",
  "Rue de la République",
  "Place Bellecour",
  // G4 Marseille
  "Cours Julien",
  "Vieux-Port",
  "La Canebière",
  "Notre-Dame de la Garde",
  // G5 Côte d’Azur
  "Rue d’Antibes Cannes",
  "Place Masséna Nice",
  "La Croisette",
  "Promenade des Anglais",
  // G6 Rive Gauche
  "Rue Mouffetard",
  "Boulevard Saint-Michel",
  "Jardin du Luxembourg",
  "Bd Saint-Germain",
  // G7 Montmartre
  "Rue Lepic",
  "Place du Tertre",
  "Boulevard de Clichy",
  // G8 Paris Luxe
  "Rue de Rivoli",
  "Place Vendôme",
  "Avenue Montaigne",
  // G9 Triangle d’Or
  "Avenue Foch",
  "Champs-Élysées",
];

function layout(): string[] {
  const t: string[] = new Array(BOARD_SIZE);
  const idx = [
    1, 3, 6, 8, 9, 10, 11, 12, 14, 16, 17, 18, 20, 22, 23, 25, 27, 29, 30, 31, 33, 34, 36, 38, 40,
    41, 43, 46, 47, 48, 50, 51,
  ];
  idx.forEach((i, n) => {
    t[i] = streets[n] ?? "";
  });
  t[0] = "Embarquement";
  t[13] = "Garde à vue";
  t[26] = "Aire de repos";
  t[39] = "Démasqué !";
  t[5] = "Gare du Nord";
  t[19] = "Gare de Lyon";
  t[32] = "Gare Montparnasse";
  t[44] = "Gare Saint-Lazare";
  t[15] = "Compagnie Électrique";
  t[35] = "Compagnie des Eaux";
  t[42] = "Réseau Fibre";
  t[4] = "Impôt sur le revenu";
  t[49] = "Taxe de luxe";
  for (const i of [7, 24, 28, 45]) {
    t[i] = "Carte postale";
  }
  for (const i of [2, 21, 37]) {
    t[i] = "Mairie";
  }
  return t;
}

const tileNames = layout();
const m = (n: number) => `${n} €`;

export const fr: Theme = {
  id: "fr",
  name: "Frankreich",
  flag: "🇫🇷",
  locale: "fr-FR",
  currency: { code: "EUR", symbol: "€", position: "after" },
  tileNames,
  groupColors: [
    "#a47c5b",
    "#9ed8f0",
    "#f08fc0",
    "#f5a65b",
    "#e8606a",
    "#f6dc5a",
    "#6fc48a",
    "#4c6fcf",
    "#8e6fcf",
    "#2f3e5c",
  ],
  groupNames: [
    "Lille",
    "Strasbourg",
    "Bordeaux",
    "Lyon",
    "Marseille",
    "Côte d’Azur",
    "Rive Gauche",
    "Montmartre",
    "Paris Luxe",
    "Triangle d’Or",
  ],
  cardTexts: {
    "ch-go": `Trotz Streik fährt der Zug: Fliege direkt zum Embarquement und kassiere ${m(200)}.`,
    "ch-g9-last": `Reise weiter nach ${tileNames[51]}, wo man sieht und gesehen wird. Kommst du dabei am Embarquement vorbei, kassierst du ${m(200)}.`,
    "ch-g6-first": `Croissant-Pause am linken Seine-Ufer: Reise weiter nach ${tileNames[33]}. Kommst du dabei am Embarquement vorbei, kassierst du ${m(200)}.`,
    "ch-g3-first": `Reise weiter nach ${tileNames[14]} und bestelle ein Bouchon-Menü. Kommst du dabei am Embarquement vorbei, kassierst du ${m(200)}.`,
    "ch-station-1": `Reise weiter nach ${tileNames[5]}. Kommst du dabei am Embarquement vorbei, kassierst du ${m(200)}.`,
    "ch-nearest-station":
      "Fahre zum nächsten Bahnhof. Hat er einen Besitzer, zahle ihm die doppelte Miete (TGV, natürlich mit Reservierungspflicht).",
    "ch-nearest-station-2":
      "Die SNCF meldet einen Streik, du nimmst den nächsten Bahnhof: Fahre hin und zahle dem Besitzer die doppelte Miete.",
    "ch-nearest-utility":
      "Fahre zum nächsten Werk. Hat es einen Besitzer, würfle und zahle ihm das Zehnfache der Augenzahl.",
    "ch-back-3": "Du hast dich im Kreisverkehr am Arc de Triomphe verfahren: Gehe 3 Felder zurück.",
    "ch-jail": "Du hast beim Pétanque geschummelt: Aufgeflogen! Ab in die Garde à vue.",
    "ch-jail-card":
      "Gute Beziehungen öffnen Türen: Hebe die Karte auf. In der U-Haft spielst du sie aus und bist sofort frei.",
    "ch-dividend": `Dividende aus deinem Weingut: Du erhältst ${m(50)}.`,
    "ch-loan": `Dein Bankdarlehen wird ausgezahlt: Du erhältst ${m(150)}.`,
    "ch-speeding": `Blitzer auf dem Périphérique: Busse ${m(15)}.`,
    "ch-chairman": `Du wirst zum Präsidenten des Boulevard-Clubs gewählt. Zahle jedem Mitspieler ${m(50)} für den Champagner.`,
    "ch-repairs": `Die Mairie schickt die Rechnung für die Fassade: ${m(25)} pro Haus, ${m(100)} pro Hotel, ${m(200)} pro Wolkenkratzer.`,
    "cc-go": `Fliege direkt zum Embarquement und kassiere ${m(200)}. Vive la France!`,
    "cc-bank-error": `Die Bank überweist dir versehentlich zu viel: Du erhältst ${m(200)}.`,
    "cc-doctor": `Arztrechnung nach zu viel Foie gras: Zahle ${m(50)}.`,
    "cc-stock": `Du verkaufst Aktien an der Börse von Paris: Du erhältst ${m(50)}.`,
    "cc-jail-card":
      "Ein wasserdichtes Alibi: Hebe die Karte auf. In der U-Haft spielst du sie aus und bist sofort frei.",
    "cc-jail": "Du hast das Baguette nicht bezahlt: Aufgeflogen! Ab in die Garde à vue.",
    "cc-holiday": `Congés payés: Dein Urlaubsgeld beträgt ${m(100)}.`,
    "cc-tax-refund": `Steuerrückerstattung vom Finanzamt: Du erhältst ${m(20)}.`,
    "cc-birthday": `Du hast Geburtstag: Jeder Mitspieler schenkt dir ${m(10)} und ein Pain au chocolat.`,
    "cc-insurance": `Die Lebensversicherung wird fällig: Du erhältst ${m(100)}.`,
    "cc-hospital": `Krankenhauskosten: Zahle ${m(100)}.`,
    "cc-school": `Schulgeld für die Grande École: Zahle ${m(50)}.`,
    "cc-consultancy": `Beratungshonorar für ein Pariser Start-up: Du erhältst ${m(25)}.`,
    "cc-street-repairs": `Die Stadt saniert die Pflastersteine: Zahle ${m(40)} pro Haus, ${m(115)} pro Hotel und ${m(250)} pro Wolkenkratzer.`,
    "cc-beauty": `Du gewinnst den zweiten Preis beim Käse-Wettbewerb (Camembert): Du erhältst ${m(10)}.`,
    "cc-inherit": `Eine Tante aus der Provence vererbt dir ${m(100)}.`,
  },
  deckNames: { chance: "Postkarte", community: "Mairie" },
  botNames: [
    "Jean Baguette",
    "Amélie Croissant",
    "Pierre Camembert",
    "Brigitte Bordeaux",
    "Gaston Escargot",
    "Marcel Macaron",
    "Coco Crêpe",
    "Lulu Lavande",
  ],
  tokens: [
    { id: "baguette", name: "Baguette" },
    { id: "beret", name: "Baskenmütze" },
    { id: "rooster", name: "Gallischer Hahn" },
    { id: "croissant", name: "Croissant" },
    { id: "wine-bottle", name: "Weinflasche" },
    { id: "eiffel", name: "Eiffelturm" },
    { id: "scooter", name: "Motorroller" },
    { id: "perfume", name: "Parfümflakon" },
  ],
  i18n: {
    en: {
      name: "France",
      groupNames: [
        "Lille",
        "Strasbourg",
        "Bordeaux",
        "Lyon",
        "Marseille",
        "French Riviera",
        "Left Bank",
        "Montmartre",
        "Luxury Paris",
        "Golden Triangle",
      ],
      deckNames: { chance: "Postcard", community: "Town hall" },
      tokenNames: {
        baguette: "Baguette",
        beret: "Beret",
        rooster: "Gallic Rooster",
        croissant: "Croissant",
        "wine-bottle": "Wine Bottle",
        eiffel: "Eiffel Tower",
        scooter: "Scooter",
        perfume: "Perfume Bottle",
      },
      cardTexts: {
        "ch-go": `The train runs despite the strike: Fly straight to Embarquement and collect ${m(200)}.`,
        "ch-g9-last": `Travel on to ${tileNames[51]}, where one sees and is seen. Passing Embarquement on the way pays ${m(200)}.`,
        "ch-g6-first": `Croissant break on the Left Bank: Travel on to ${tileNames[33]}. Passing Embarquement on the way pays ${m(200)}.`,
        "ch-g3-first": `Travel on to ${tileNames[14]} and order a bouchon menu. Passing Embarquement on the way pays ${m(200)}.`,
        "ch-station-1": `Travel on to ${tileNames[5]}. Passing Embarquement on the way pays ${m(200)}.`,
        "ch-nearest-station":
          "Head for the nearest station. If it has an owner, pay the owner twice the rent (TGV, reservation compulsory of course).",
        "ch-nearest-station-2":
          "SNCF announces a strike, so you take the nearest station: Head there and pay the owner twice the rent.",
        "ch-nearest-utility":
          "Head for the nearest utility. If it has an owner, roll the dice and pay the owner ten times the number rolled.",
        "ch-back-3": "You got lost on the roundabout at the Arc de Triomphe: Go back 3 spaces.",
        "ch-jail": "You cheated at pétanque: Busted! Straight to custody.",
        "ch-jail-card":
          "Good connections open doors: Hold on to this card. If you land in custody, play it to walk free at once.",
        "ch-dividend": `Dividend from your vineyard: You receive ${m(50)}.`,
        "ch-loan": `Your bank loan is paid out: You receive ${m(150)}.`,
        "ch-speeding": `Speed camera on the Périphérique: Fine ${m(15)}.`,
        "ch-chairman": `You are elected president of the Boulevard Club. Pay each player ${m(50)} for the champagne.`,
        "ch-repairs": `The Mairie sends the bill for the façade: ${m(25)} per house, ${m(100)} per hotel, ${m(200)} per skyscraper.`,
        "cc-go": `Fly straight to Embarquement and collect ${m(200)}. Vive la France!`,
        "cc-bank-error": `The bank transfers you too much by mistake: You receive ${m(200)}.`,
        "cc-doctor": `Doctor's bill after too much foie gras: Pay ${m(50)}.`,
        "cc-stock": `You sell shares on the Paris Bourse: You receive ${m(50)}.`,
        "cc-jail-card":
          "A watertight alibi: Hold on to this card. If you land in custody, play it to walk free at once.",
        "cc-jail": "You did not pay for the baguette: Busted! Straight to custody.",
        "cc-holiday": `Congés payés: Your holiday pay is ${m(100)}.`,
        "cc-tax-refund": `Tax refund from the tax office: You receive ${m(20)}.`,
        "cc-birthday": `It is your birthday: Every player gives you ${m(10)} and a pain au chocolat.`,
        "cc-insurance": `Your life insurance matures: You receive ${m(100)}.`,
        "cc-hospital": `Hospital costs: Pay ${m(100)}.`,
        "cc-school": `Tuition for the Grande École: Pay ${m(50)}.`,
        "cc-consultancy": `Consulting fee for a Parisian start-up: You receive ${m(25)}.`,
        "cc-street-repairs": `The city renovates the cobblestones: Pay ${m(40)} per house, ${m(115)} per hotel and ${m(250)} per skyscraper.`,
        "cc-beauty": `You win second prize in the cheese contest (Camembert): You receive ${m(10)}.`,
        "cc-inherit": `An aunt from Provence leaves you ${m(100)}.`,
      },
    },
  },
  securities: FR_SECURITIES,
  scenicGroups: [5, 7],
  environment: "paris",
  landmark: "landmark-eiffel",
  skyscraperModels: { 9: "skyscraper-la-defense" },
};
