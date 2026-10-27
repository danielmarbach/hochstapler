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
    "ch-go": `Im Pilotenkostüm vom Karneval in Venedig: Fliege direkt zum Imbarco und kassiere ${m(200)}.`,
    "ch-g9-last": `Ein Juwelier hält dich für einen Principe: Reise weiter nach ${tileNames[51]}. Kommst du dabei am Imbarco vorbei, kassierst du ${m(200)}.`,
    "ch-g6-first": `Pesto-Hunger: Reise weiter nach ${tileNames[33]}. Kommst du dabei am Imbarco vorbei, kassierst du ${m(200)}.`,
    "ch-g3-first": `Gianduiotto-Pause in Piemont: Reise weiter nach ${tileNames[14]}. Kommst du dabei am Imbarco vorbei, kassierst du ${m(200)}.`,
    "ch-station-1": `Gefälschter Freifahrschein: Reise weiter nach ${tileNames[5]}. Kommst du dabei am Imbarco vorbei, kassierst du ${m(200)}.`,
    "ch-nearest-station":
      "Fahre zum nächsten Bahnhof. Hat er einen Besitzer, zahle ihm die doppelte Miete (sciopero bedingt).",
    "ch-nearest-station-2":
      "Trenitalia hat wieder Verspätung: Fahre zum nächsten Bahnhof und zahle dem Besitzer die doppelte Miete.",
    "ch-nearest-utility":
      "Falscher Zählerableser: Fahre zum nächsten Werk. Hat es einen Besitzer, würfle und zahle ihm das Zehnfache der Augenzahl.",
    "ch-back-3": "Im Kreisverkehr falsch abgebogen: Gehe 3 Felder zurück.",
    "ch-jail": "Dein Gondoliere-Patent ist ein Souvenir: Aufgeflogen! Ab in die Questura.",
    "ch-jail-card":
      "Die Carabinieri glauben dir, das sei ein Dreh für Cinecittà: Hebe die Karte auf. In der U-Haft spielst du sie aus und bist sofort frei.",
    "ch-dividend": `Dividende deiner Olivenölfirma (ein Baum, eine Flasche): Du erhältst ${m(50)}.`,
    "ch-loan": `Du verkaufst die Fontana di Trevi zum zweiten Mal: Du erhältst ${m(150)}.`,
    "ch-speeding": `Autovelox auf der Autostrada: Busse ${m(15)}.`,
    "ch-chairman": `Im Casinò von Sanremo spielst du den Conte: Zahle jedem Mitspieler ${m(50)} für den Espresso.`,
    "ch-repairs": `Der Condominio schickt die Rechnung: ${m(25)} pro Haus, ${m(100)} pro Hotel, ${m(200)} pro Wolkenkratzer.`,
    "cc-go": `Fliege direkt zum Imbarco und kassiere ${m(200)}. Andiamo!`,
    "cc-bank-error": `Die Bank verwechselt dich mit einem Conte aus Florenz: Du erhältst ${m(200)}.`,
    "cc-doctor": `Arztrechnung nach zu viel Tiramisù: Zahle ${m(50)}.`,
    "cc-stock": `Du verkaufst Aktien deiner Spaghetti-Plantage am Comer See: Du erhältst ${m(50)}.`,
    "cc-jail-card":
      "Alle Nonnas schwören, du warst beim Sonntagsessen: Hebe die Karte auf. In der U-Haft spielst du sie aus und bist sofort frei.",
    "cc-jail":
      "Du hast das Kolosseum als Ferienwohnung vermietet: Aufgeflogen! Ab in die Questura.",
    "cc-holiday": `Capri hält dich für einen Filmstar: Du erhältst ${m(100)}.`,
    "cc-tax-refund": `Steuerrückerstattung vom Finanzamt (ein Wunder): Du erhältst ${m(20)}.`,
    "cc-birthday": `Namenstag für jeden deiner falschen Namen: Jeder Mitspieler schenkt dir ${m(10)} und ein Stück Torta.`,
    "cc-insurance": `Die Versicherung ersetzt deine „antike“ Kiosk-Amphore: Du erhältst ${m(100)}.`,
    "cc-hospital": `Falscher Tenor, echte Halsentzündung: Zahle ${m(100)}.`,
    "cc-school": `Kochkurs für den falschen Sternekoch: Zahle ${m(50)}.`,
    "cc-consultancy": `Honorar als falscher Stilberater in Mailand: Du erhältst ${m(25)}.`,
    "cc-street-repairs": `Die Gemeinde saniert die Pflastersteine: Zahle ${m(40)} pro Haus, ${m(115)} pro Hotel und ${m(250)} pro Wolkenkratzer.`,
    "cc-beauty": `Du gewinnst den zweiten Preis beim Gelato-Wettbewerb: Du erhältst ${m(10)}.`,
    "cc-inherit": `Eine toskanische Nonna hält dich für ihren Enkel: Du erbst ${m(100)}.`,
  },
  deckNames: { chance: "Postkarte", community: "Comune" },
  lender: "Der Bankier an der Piazza Affari",
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
        "ch-go": `In a pilot costume from the Venice carnival: Fly straight to Imbarco and collect ${m(200)}.`,
        "ch-g9-last": `A jeweller takes you for a principe: Travel on to ${tileNames[51]}. Passing Imbarco on the way pays ${m(200)}.`,
        "ch-g6-first": `Craving pesto: Travel on to ${tileNames[33]}. Passing Imbarco on the way pays ${m(200)}.`,
        "ch-g3-first": `Gianduiotto break in Piedmont: Travel on to ${tileNames[14]}. Passing Imbarco on the way pays ${m(200)}.`,
        "ch-station-1": `Forged free pass: Travel on to ${tileNames[5]}. Passing Imbarco on the way pays ${m(200)}.`,
        "ch-nearest-station":
          "Head for the nearest station. If it has an owner, pay the owner twice the rent (strike permitting).",
        "ch-nearest-station-2":
          "Trenitalia is late again: Head for the nearest station and pay the owner twice the rent.",
        "ch-nearest-utility":
          "Fake meter reader: Head for the nearest utility. If it has an owner, roll the dice and pay the owner ten times the number rolled.",
        "ch-back-3": "You took the wrong exit at the roundabout: Go back 3 spaces.",
        "ch-jail": "Your gondolier licence is a souvenir: Busted! Straight to custody.",
        "ch-jail-card":
          "The carabinieri believe it is a film shoot for Cinecittà: Hold on to this card. If you land in custody, play it to walk free at once.",
        "ch-dividend": `Dividend from your olive oil firm (one tree, one bottle): You receive ${m(50)}.`,
        "ch-loan": `You sell the Trevi Fountain for the second time: You receive ${m(150)}.`,
        "ch-speeding": `Autovelox on the autostrada: Fine ${m(15)}.`,
        "ch-chairman": `At the Sanremo casino you play the conte: Pay each player ${m(50)} for the espresso.`,
        "ch-repairs": `The condominio sends the bill: ${m(25)} per house, ${m(100)} per hotel, ${m(200)} per skyscraper.`,
        "cc-go": `Fly straight to Imbarco and collect ${m(200)}. Andiamo!`,
        "cc-bank-error": `The bank mistakes you for a conte from Florence: You receive ${m(200)}.`,
        "cc-doctor": `Doctor's bill after too much tiramisù: Pay ${m(50)}.`,
        "cc-stock": `You sell shares in your spaghetti plantation on Lake Como: You receive ${m(50)}.`,
        "cc-jail-card":
          "Every nonna swears you were at Sunday lunch: Hold on to this card. If you land in custody, play it to walk free at once.",
        "cc-jail": "You let the Colosseum as a holiday flat: Busted! Straight to custody.",
        "cc-holiday": `Capri takes you for a film star: You receive ${m(100)}.`,
        "cc-tax-refund": `Tax refund from the tax office (a miracle): You receive ${m(20)}.`,
        "cc-birthday": `A name day for each of your fake names: Every player gives you ${m(10)} and a slice of torta.`,
        "cc-insurance": `The insurer replaces your “antique” kiosk amphora: You receive ${m(100)}.`,
        "cc-hospital": `Fake tenor, real sore throat: Pay ${m(100)}.`,
        "cc-school": `Cooking class for the fake star chef: Pay ${m(50)}.`,
        "cc-consultancy": `Fee as a fake style adviser in Milan: You receive ${m(25)}.`,
        "cc-street-repairs": `The municipality renovates the cobblestones: Pay ${m(40)} per house, ${m(115)} per hotel and ${m(250)} per skyscraper.`,
        "cc-beauty": `You win second prize in the gelato contest: You receive ${m(10)}.`,
        "cc-inherit": `A Tuscan nonna takes you for her grandson: You inherit ${m(100)}.`,
      },
    },
  },
  securities: IT_SECURITIES,
  scenicGroups: [6, 7],
  environment: "tuscany",
  landmark: "landmark-colosseum",
};
