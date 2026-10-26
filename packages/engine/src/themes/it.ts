import type { Theme } from "../theme-types.ts";
import { BOARD_SIZE } from "../types.ts";
import { IT_SECURITIES } from "./securities.ts";

const streets = [
  // G0 Sicilia
  "Via Maqueda Palermo",
  "Corso Ortigia",
  // G1 Napoli
  "Spaccanapoli",
  "Via Toledo",
  "Lungomare Caracciolo",
  // G2 Bologna
  "Via Zamboni",
  "Via Indipendenza",
  "Piazza Maggiore",
  // G3 Torino
  "Via Po",
  "Piazza San Carlo",
  "Via Roma Torino",
  "Mole Antonelliana",
  // G4 Firenze
  "Piazzale Michelangelo",
  "Via dei Calzaiuoli",
  "Ponte Vecchio",
  "Piazza del Duomo",
  // G5 Venezia
  "Calle Larga",
  "Riva degli Schiavoni",
  "Ponte di Rialto",
  "Piazza San Marco",
  // G6 Liguria
  "Via del Campo",
  "Cinque Terre",
  "Via Matteotti Sanremo",
  "Piazzetta Portofino",
  // G7 Capri
  "Via Camerelle",
  "Piazzetta di Capri",
  "Costiera Amalfitana",
  // G8 Milano
  "Navigli",
  "Galleria V. Emanuele",
  "Via Montenapoleone",
  // G9 Roma
  "Piazza di Spagna",
  "Via Condotti",
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
  t[0] = "Imbarco";
  t[13] = "Questura";
  t[26] = "Area di sosta";
  t[39] = "Smascherato!";
  t[5] = "Roma Termini";
  t[19] = "Milano Centrale";
  t[32] = "Napoli Centrale";
  t[44] = "Firenze S.M.N.";
  t[15] = "Enel Energia";
  t[35] = "Acquedotto";
  t[42] = "Rete Telecom";
  t[4] = "Imposta sul reddito";
  t[49] = "Tassa di lusso";
  for (const i of [7, 24, 28, 45]) {
    t[i] = "Cartolina";
  }
  for (const i of [2, 21, 37]) {
    t[i] = "Comune";
  }
  return t;
}

const tileNames = layout();
const m = (n: number) => `${n} €`;

export const it: Theme = {
  id: "it",
  name: "Italien",
  flag: "🇮🇹",
  locale: "it-IT",
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
    "Sicilia",
    "Napoli",
    "Bologna",
    "Torino",
    "Firenze",
    "Venezia",
    "Liguria",
    "Capri",
    "Milano",
    "Roma",
  ],
  cardTexts: {
    "ch-go": `Der Zug ist ausnahmsweise pünktlich: Fliege direkt zum Imbarco und kassiere ${m(200)}.`,
    "ch-g9-last": `Aperitivo im Herzen Roms: Reise weiter nach ${tileNames[51]}. Kommst du dabei am Imbarco vorbei, kassierst du ${m(200)}.`,
    "ch-g6-first": `Pesto-Hunger: Reise weiter nach ${tileNames[33]}. Kommst du dabei am Imbarco vorbei, kassierst du ${m(200)}.`,
    "ch-g3-first": `Gianduiotto-Pause in Piemont: Reise weiter nach ${tileNames[14]}. Kommst du dabei am Imbarco vorbei, kassierst du ${m(200)}.`,
    "ch-station-1": `Reise weiter nach ${tileNames[5]}. Kommst du dabei am Imbarco vorbei, kassierst du ${m(200)}.`,
    "ch-nearest-station":
      "Fahre zum nächsten Bahnhof. Hat er einen Besitzer, zahle ihm die doppelte Miete (sciopero bedingt).",
    "ch-nearest-station-2":
      "Trenitalia hat wieder Verspätung: Fahre zum nächsten Bahnhof und zahle dem Besitzer die doppelte Miete.",
    "ch-nearest-utility":
      "Fahre zum nächsten Werk. Hat es einen Besitzer, würfle und zahle ihm das Zehnfache der Augenzahl.",
    "ch-back-3": "Im Kreisverkehr falsch abgebogen: Gehe 3 Felder zurück.",
    "ch-jail": "Du hast Ketchup auf die Pasta getan: Aufgeflogen! Ab in die Questura.",
    "ch-jail-card":
      "Eine Empfehlung (raccomandazione) wirkt Wunder: Hebe die Karte auf. In der U-Haft spielst du sie aus und bist sofort frei.",
    "ch-dividend": `Dividende aus deiner Olivenölfirma: Du erhältst ${m(50)}.`,
    "ch-loan": `Dein Bankdarlehen wird ausgezahlt: Du erhältst ${m(150)}.`,
    "ch-speeding": `Autovelox auf der Autostrada: Busse ${m(15)}.`,
    "ch-chairman": `Du wirst zum Präsidenten des Fussballclubs gewählt. Zahle jedem Mitspieler ${m(50)} für den Espresso.`,
    "ch-repairs": `Der Condominio schickt die Rechnung: ${m(25)} pro Haus, ${m(100)} pro Hotel, ${m(200)} pro Wolkenkratzer.`,
    "cc-go": `Fliege direkt zum Imbarco und kassiere ${m(200)}. Andiamo!`,
    "cc-bank-error": `Die Bank überweist dir versehentlich zu viel: Du erhältst ${m(200)}.`,
    "cc-doctor": `Arztrechnung nach zu viel Tiramisù: Zahle ${m(50)}.`,
    "cc-stock": `Du verkaufst Aktien an der Mailänder Börse: Du erhältst ${m(50)}.`,
    "cc-jail-card":
      "Ein wasserdichtes Alibi: Hebe die Karte auf. In der U-Haft spielst du sie aus und bist sofort frei.",
    "cc-jail": "Fahren ohne Helm auf der Vespa: Aufgeflogen! Ab in die Questura.",
    "cc-holiday": `Ferragosto-Zuschuss: Du erhältst ${m(100)}.`,
    "cc-tax-refund": `Steuerrückerstattung vom Finanzamt (ein Wunder): Du erhältst ${m(20)}.`,
    "cc-birthday": `Du hast Geburtstag: Jeder Mitspieler schenkt dir ${m(10)} und ein Stück Torta.`,
    "cc-insurance": `Deine Lebensversicherung wird fällig: Du erhältst ${m(100)}.`,
    "cc-hospital": `Krankenhauskosten: Zahle ${m(100)}.`,
    "cc-school": `Schulgeld für die Privatschule: Zahle ${m(50)}.`,
    "cc-consultancy": `Beratungshonorar für ein Mailänder Modehaus: Du erhältst ${m(25)}.`,
    "cc-street-repairs": `Die Gemeinde saniert die Pflastersteine: Zahle ${m(40)} pro Haus, ${m(115)} pro Hotel und ${m(250)} pro Wolkenkratzer.`,
    "cc-beauty": `Du gewinnst den zweiten Preis beim Gelato-Wettbewerb: Du erhältst ${m(10)}.`,
    "cc-inherit": `Die Nonna aus der Toskana vererbt dir ${m(100)}.`,
  },
  deckNames: { chance: "Postkarte", community: "Comune" },
  botNames: [
    "Luigi Lasagne",
    "Giulia Gelato",
    "Mario Mozzarella",
    "Franca Focaccia",
    "Paolo Pesto",
    "Sofia Spritz",
    "Enzo Espresso",
    "Nonna Tiramisù",
  ],
  tokens: [
    { id: "vespa", name: "Vespa" },
    { id: "pizza", name: "Pizza" },
    { id: "espresso", name: "Espresso" },
    { id: "gondola-venice", name: "Gondel" },
    { id: "colosseum", name: "Kolosseum" },
    { id: "pasta", name: "Pasta" },
    { id: "gelato", name: "Gelato" },
    { id: "tower-pisa", name: "Schiefer Turm" },
  ],
  i18n: {
    en: {
      name: "Italy",
      groupNames: [
        "Sicily",
        "Naples",
        "Bologna",
        "Turin",
        "Florence",
        "Venice",
        "Liguria",
        "Capri",
        "Milan",
        "Rome",
      ],
      deckNames: { chance: "Postcard", community: "Municipality" },
      tokenNames: {
        vespa: "Vespa",
        pizza: "Pizza",
        espresso: "Espresso",
        "gondola-venice": "Gondola",
        colosseum: "Colosseum",
        pasta: "Pasta",
        gelato: "Gelato",
        "tower-pisa": "Leaning Tower",
      },
      cardTexts: {
        "ch-go": `The train is on time for once: Fly straight to Imbarco and collect ${m(200)}.`,
        "ch-g9-last": `Aperitivo in the heart of Rome: Travel on to ${tileNames[51]}. Passing Imbarco on the way pays ${m(200)}.`,
        "ch-g6-first": `Craving pesto: Travel on to ${tileNames[33]}. Passing Imbarco on the way pays ${m(200)}.`,
        "ch-g3-first": `Gianduiotto break in Piedmont: Travel on to ${tileNames[14]}. Passing Imbarco on the way pays ${m(200)}.`,
        "ch-station-1": `Travel on to ${tileNames[5]}. Passing Imbarco on the way pays ${m(200)}.`,
        "ch-nearest-station":
          "Head for the nearest station. If it has an owner, pay the owner twice the rent (strike permitting).",
        "ch-nearest-station-2":
          "Trenitalia is late again: Head for the nearest station and pay the owner twice the rent.",
        "ch-nearest-utility":
          "Head for the nearest utility. If it has an owner, roll the dice and pay the owner ten times the number rolled.",
        "ch-back-3": "You took the wrong exit at the roundabout: Go back 3 spaces.",
        "ch-jail": "You put ketchup on your pasta: Busted! Straight to custody.",
        "ch-jail-card":
          "A recommendation (raccomandazione) works wonders: Hold on to this card. If you land in custody, play it to walk free at once.",
        "ch-dividend": `Dividend from your olive oil company: You receive ${m(50)}.`,
        "ch-loan": `Your bank loan is paid out: You receive ${m(150)}.`,
        "ch-speeding": `Autovelox on the autostrada: Fine ${m(15)}.`,
        "ch-chairman": `You are elected president of the football club. Pay each player ${m(50)} for the espresso.`,
        "ch-repairs": `The condominio sends the bill: ${m(25)} per house, ${m(100)} per hotel, ${m(200)} per skyscraper.`,
        "cc-go": `Fly straight to Imbarco and collect ${m(200)}. Andiamo!`,
        "cc-bank-error": `The bank transfers you too much by mistake: You receive ${m(200)}.`,
        "cc-doctor": `Doctor's bill after too much tiramisù: Pay ${m(50)}.`,
        "cc-stock": `You sell shares on the Milan stock exchange: You receive ${m(50)}.`,
        "cc-jail-card":
          "A watertight alibi: Hold on to this card. If you land in custody, play it to walk free at once.",
        "cc-jail": "Riding a Vespa without a helmet: Busted! Straight to custody.",
        "cc-holiday": `Ferragosto bonus: You receive ${m(100)}.`,
        "cc-tax-refund": `Tax refund from the tax office (a miracle): You receive ${m(20)}.`,
        "cc-birthday": `It is your birthday: Every player gives you ${m(10)} and a slice of torta.`,
        "cc-insurance": `Your life insurance matures: You receive ${m(100)}.`,
        "cc-hospital": `Hospital costs: Pay ${m(100)}.`,
        "cc-school": `Tuition for the private school: Pay ${m(50)}.`,
        "cc-consultancy": `Consulting fee for a Milan fashion house: You receive ${m(25)}.`,
        "cc-street-repairs": `The municipality renovates the cobblestones: Pay ${m(40)} per house, ${m(115)} per hotel and ${m(250)} per skyscraper.`,
        "cc-beauty": `You win second prize in the gelato contest: You receive ${m(10)}.`,
        "cc-inherit": `The nonna from Tuscany leaves you ${m(100)}.`,
      },
    },
  },
  securities: IT_SECURITIES,
  scenicGroups: [6, 7],
  environment: "tuscany",
  landmark: "landmark-colosseum",
};
