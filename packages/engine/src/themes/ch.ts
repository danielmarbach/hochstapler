import type { Theme } from "../theme-types.ts";
import { BOARD_SIZE } from "../types.ts";
import { CH_SECURITIES } from "./securities.ts";

const streets = [
  // G0 Graubünden
  "Poststrasse Chur",
  "Promenade Davos",
  // G1 Luzern
  "Weggisgasse",
  "Pilatusstrasse",
  "Kapellbrücke",
  // G2 Basel
  "Rheinsprung",
  "Spalenvorstadt",
  "Freie Strasse",
  // G3 Bern
  "Kramgasse",
  "Marktgasse",
  "Spitalgasse",
  "Bundesplatz",
  // G4 Tessin
  "Piazza Grande Locarno",
  "Lungolago Ascona",
  "Piazza Riforma Lugano",
  "Via Nassa Lugano",
  // G5 Waadt
  "Quai de Montreux",
  "Rue de Bourg",
  "Place St-François",
  "Château de Chillon",
  // G6 Genève
  "Place du Molard",
  "Rue du Mont-Blanc",
  "Quai du Mont-Blanc",
  "Rue du Rhône",
  // G7 Zug
  "Vorstadt Zug",
  "Seestrasse Zug",
  "Baarerstrasse",
  // G8 Engadin
  "Via Maistra",
  "Corviglia",
  "Via Serlas",
  // G9 Zürich
  "Bahnhofstrasse",
  "Paradeplatz",
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
  t[0] = "Abflug";
  t[13] = "U-Haft";
  t[26] = "Rastplatz";
  t[39] = "Aufgeflogen!";
  t[5] = "Zürich HB";
  t[19] = "Bern";
  t[32] = "Basel SBB";
  t[44] = "Genève Cornavin";
  t[15] = "Elektrizitätswerk";
  t[35] = "Wasserwerk";
  t[42] = "Swisscom-Netz";
  t[4] = "Bundessteuer";
  t[49] = "Kurtaxe";
  for (const i of [7, 24, 28, 45]) {
    t[i] = "Postkarte";
  }
  for (const i of [2, 21, 37]) {
    t[i] = "Kanton";
  }
  return t;
}

const tileNames = layout();
const m = (n: number) => `CHF ${n}`;

export const ch: Theme = {
  id: "ch",
  name: "Schweiz",
  flag: "🇨🇭",
  locale: "de-CH",
  currency: { code: "CHF", symbol: "CHF", position: "before" },
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
    "Graubünden",
    "Luzern",
    "Basel",
    "Bern",
    "Tessin",
    "Waadt",
    "Genève",
    "Zug",
    "Engadin",
    "Zürich",
  ],
  cardTexts: {
    "ch-go":
      "Der Zug fährt ausnahmsweise pünktlich: Fliege direkt zum Abflug und kassiere " +
      m(200) +
      ".",
    "ch-g9-last": `Als falscher Privatbankier im geliehenen Nadelstreif: Reise weiter nach ${tileNames[51]}. Kommst du dabei am Abflug vorbei, kassierst du ${m(200)}.`,
    "ch-g6-first": `Als falscher Diplomat zum Empfang am See: Reise weiter nach ${tileNames[33]}. Kommst du dabei am Abflug vorbei, kassierst du ${m(200)}.`,
    "ch-g3-first": `Mit selbst gebasteltem Bundeshaus-Badge: Reise weiter nach ${tileNames[14]}. Kommst du dabei am Abflug vorbei, kassierst du ${m(200)}.`,
    "ch-station-1": `Falscher Kondukteur: Reise weiter nach ${tileNames[5]}. Kommst du dabei am Abflug vorbei, kassierst du ${m(200)}.`,
    "ch-nearest-station":
      "Fahre zum nächsten Bahnhof. Hat er einen Besitzer, zahle ihm die doppelte Miete (der Anschluss war natürlich wieder verspätet).",
    "ch-nearest-station-2":
      "Die SBB meldet Verspätung auf Gleis 3: Fahre zum nächsten Bahnhof und zahle dem Besitzer die doppelte Miete.",
    "ch-nearest-utility":
      "Falscher Stromableser: Fahre zum nächsten Werk. Hat es einen Besitzer, würfle und zahle ihm das Zehnfache der Augenzahl.",
    "ch-back-3": "Röstigraben-Navigation: Gehe 3 Felder zurück.",
    "ch-jail":
      "Das Palace in Gstaad merkt, dass du kein Maharadscha bist: Aufgeflogen! Ab in die U-Haft.",
    "ch-jail-card":
      "Alibi: ein Selfie vor der Matterhorn-Fototapete. Hebe die Karte auf. In der U-Haft spielst du sie aus und bist sofort frei.",
    "ch-dividend": `Dividende aus deiner Matterhorn-Rolltreppe AG: ${m(50)}.`,
    "ch-loan": `Du verkaufst die Aussicht vom Pilatus zum zweiten Mal: Du erhältst ${m(150)}.`,
    "ch-speeding": `Radar am Gotthard, trotz Diplomatenschild aus Karton: Busse ${m(15)}.`,
    "ch-chairman": `Als falscher Uhren-Erbe aus Biel lädst du zum Apéro: Zahle jedem Mitspieler ${m(50)}.`,
    "ch-repairs": `Deine Kulissen-Chalets brauchen frische Farbe: ${m(25)} pro Haus, ${m(100)} pro Hotel, ${m(200)} pro Wolkenkratzer.`,
    "cc-go": "Gemeindeversammlung beendet: Fliege direkt zum Abflug und kassiere " + m(200) + ".",
    "cc-bank-error": `Die Bank überweist dir versehentlich zu viel (selten in der Schweiz!): Du erhältst ${m(200)}.`,
    "cc-doctor": `Arztrechnung, die Franchise lässt grüssen: Zahle ${m(50)}.`,
    "cc-stock": `Du verkaufst Anteile an einer Goldmine im Säntis: Du erhältst ${m(50)}.`,
    "cc-jail-card":
      "Die ganze Seilschaft schwört, du warst am Berg: Hebe die Karte auf. In der U-Haft spielst du sie aus und bist sofort frei.",
    "cc-jail": "Unbewilligte Alphorn-Probe im Wohnquartier: Aufgeflogen! Ab in die U-Haft.",
    "cc-holiday": `Ein Grotto im Tessin hält dich für den Gastrokritiker: Du erhältst ${m(100)}.`,
    "cc-tax-refund": `Das Steueramt glaubt dir den Wohnsitz in Zug: Du erhältst ${m(20)}.`,
    "cc-birthday": `Du hast (schon wieder) Geburtstag: Jeder Mitspieler schenkt dir ${m(10)} und eine Schoggi.`,
    "cc-insurance": `Die Versicherung ersetzt deine «antike» Flohmarkt-Uhr: Du erhältst ${m(100)}.`,
    "cc-hospital": `Spitalkosten, Krankenkassenprämie steigt wieder: Zahle ${m(100)}.`,
    "cc-school": `Echter Kurs für dein falsches Skilehrer-Patent in Zermatt: Zahle ${m(50)}.`,
    "cc-consultancy": `Eine Zuger Firma bezahlt dich als «Krypto-Experten»: Du erhältst ${m(25)}.`,
    "cc-street-repairs": `Der Kanton saniert die Strassen: Zahle ${m(40)} pro Haus, ${m(115)} pro Hotel und ${m(250)} pro Wolkenkratzer.`,
    "cc-beauty": `Du gewinnst den Käse-Schönheitswettbewerb (zweiter Platz): Du erhältst ${m(10)}.`,
    "cc-inherit": `Deine nagelneue Grosstante aus dem Emmental hinterlässt dir ${m(100)}.`,
  },
  deckNames: { chance: "Postkarte", community: "Kanton" },
  botNames: [
    "Heidi vom Pilatus",
    "Ueli Chäsli",
    "Vreni Rösti",
    "Seppi Edelweiss",
    "Trudi Fondue",
    "Fritz Fasnacht",
    "Rösli Raclette",
    "Beat Bergbahn",
  ],
  tokens: [
    { id: "cow", name: "Kuh" },
    { id: "swiss-knife", name: "Sackmesser" },
    { id: "cheese", name: "Käse" },
    { id: "watch", name: "Uhr" },
    { id: "chocolate", name: "Schokolade" },
    { id: "st-bernard", name: "Bernhardiner" },
    { id: "fondue", name: "Fondue-Caquelon" },
    { id: "gondola", name: "Gondelbahn" },
  ],
  i18n: {
    en: {
      name: "Switzerland",
      groupNames: [
        "Grisons",
        "Lucerne",
        "Basel",
        "Bern",
        "Ticino",
        "Vaud",
        "Geneva",
        "Zug",
        "Engadine",
        "Zurich",
      ],
      deckNames: { chance: "Postcard", community: "Canton" },
      tokenNames: {
        cow: "Cow",
        "swiss-knife": "Swiss Army Knife",
        cheese: "Cheese",
        watch: "Watch",
        chocolate: "Chocolate",
        "st-bernard": "St. Bernard",
        fondue: "Fondue Pot",
        gondola: "Gondola Lift",
      },
      cardTexts: {
        "ch-go": `The train is on time for once: Fly straight to Abflug and collect ${m(200)}.`,
        "ch-g9-last": `Posing as a private banker in borrowed pinstripes: Travel on to ${tileNames[51]}. Passing Abflug on the way pays ${m(200)}.`,
        "ch-g6-first": `Posing as a diplomat at a lakeside reception: Travel on to ${tileNames[33]}. Passing Abflug on the way pays ${m(200)}.`,
        "ch-g3-first": `Home-made parliament pass: Travel on to ${tileNames[14]}. Passing Abflug on the way pays ${m(200)}.`,
        "ch-station-1": `Fake conductor: Travel on to ${tileNames[5]}. Passing Abflug on the way pays ${m(200)}.`,
        "ch-nearest-station":
          "Head for the nearest station. If it has an owner, pay the owner twice the rent (the connection was late again, of course).",
        "ch-nearest-station-2":
          "SBB announces a delay on platform 3: Head for the nearest station and pay the owner twice the rent.",
        "ch-nearest-utility":
          "Fake meter reader: Head for the nearest utility. If it has an owner, roll the dice and pay the owner ten times the number rolled.",
        "ch-back-3": "Röstigraben navigation: Go back 3 spaces.",
        "ch-jail":
          "The Gstaad palace hotel finds out you are no maharaja: Busted! Straight to custody.",
        "ch-jail-card":
          "Alibi: a selfie in front of a Matterhorn wallpaper. Hold on to this card. If you land in custody, play it to walk free at once.",
        "ch-dividend": `Dividend from your Matterhorn Escalator Ltd: ${m(50)}.`,
        "ch-loan": `You sell the view from Mount Pilatus for the second time: You receive ${m(150)}.`,
        "ch-speeding": `Gotthard speed camera, cardboard diplomatic plates: Fine ${m(15)}.`,
        "ch-chairman": `As the fake heir to a Biel watch fortune, you host the apéro: Pay each player ${m(50)}.`,
        "ch-repairs": `Your film-set chalets need a fresh coat of paint: ${m(25)} per house, ${m(100)} per hotel, ${m(200)} per skyscraper.`,
        "cc-go": "Municipal assembly adjourned: Fly straight to Abflug and collect " + m(200) + ".",
        "cc-bank-error": `The bank transfers you too much by mistake (rare in Switzerland!): You receive ${m(200)}.`,
        "cc-doctor": `Doctor's bill, the deductible says hello: Pay ${m(50)}.`,
        "cc-stock": `You sell shares in a gold mine under the Säntis: You receive ${m(50)}.`,
        "cc-jail-card":
          "Your rope team swears you were on the mountain: Hold on to this card. If you land in custody, play it to walk free at once.",
        "cc-jail":
          "Unauthorised alphorn rehearsal in a residential area: Busted! Straight to custody.",
        "cc-holiday": `A Ticino grotto takes you for a food critic: You receive ${m(100)}.`,
        "cc-tax-refund": `The tax office believes you really live in Zug: You receive ${m(20)}.`,
        "cc-birthday": `It is your birthday (again): Every player gives you ${m(10)} and a piece of chocolate.`,
        "cc-insurance": `The insurer replaces your “antique” flea-market watch: You receive ${m(100)}.`,
        "cc-hospital": `Hospital costs, health insurance premiums are up again: Pay ${m(100)}.`,
        "cc-school": `A real course for your fake Zermatt ski instructor licence: Pay ${m(50)}.`,
        "cc-consultancy": `A Zug company pays you as a “crypto expert”: You receive ${m(25)}.`,
        "cc-street-repairs": `The canton renovates the roads: Pay ${m(40)} per house, ${m(115)} per hotel and ${m(250)} per skyscraper.`,
        "cc-beauty": `You win second place in the cheese beauty contest: You receive ${m(10)}.`,
        "cc-inherit": `Your brand-new great-aunt from the Emmental leaves you ${m(100)}.`,
      },
    },
  },
  securities: CH_SECURITIES,
  scenicGroups: [0, 8],
  environment: "alps",
  landmark: "landmark-matterhorn",
  skyscraperModels: { 9: "skyscraper-prime-tower" },
};
