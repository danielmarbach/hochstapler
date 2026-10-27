import type { Theme } from "../theme-types.ts";
import { BOARD_SIZE } from "../types.ts";
import { DE_SECURITIES } from "./securities.ts";

const streets = [
  // G0 Ruhrgebiet
  "Westenhellweg Dortmund",
  "Kettwiger Str. Essen",
  // G1 Leipzig
  "Grimmaische Strasse",
  "Thomaskirchhof",
  "Augustusplatz",
  // G2 Dresden
  "Prager Strasse",
  "Neumarkt Dresden",
  "Brühlsche Terrasse",
  // G3 Köln
  "Hohe Strasse",
  "Schildergasse",
  "Rheinauhafen",
  "Domplatz",
  // G4 Frankfurt
  "Zeil",
  "Römerberg",
  "Mainkai",
  "Goethestrasse",
  // G5 Hamburg
  "Reeperbahn",
  "Speicherstadt",
  "Mönckebergstrasse",
  "Jungfernstieg",
  // G6 Stuttgart
  "Calwer Strasse",
  "Königstrasse",
  "Schlossplatz",
  "Killesberg",
  // G7 München
  "Viktualienmarkt",
  "Marienplatz",
  "Maximilianstrasse",
  // G8 Berlin
  "Alexanderplatz",
  "Kurfürstendamm",
  "Potsdamer Platz",
  // G9 Berlin Mitte
  "Unter den Linden",
  "Pariser Platz",
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
  t[5] = "Hauptbahnhof Berlin";
  t[19] = "Hauptbahnhof Hamburg";
  t[32] = "Hauptbahnhof München";
  t[44] = "Hauptbahnhof Frankfurt";
  t[15] = "Elektrizitätswerk";
  t[35] = "Wasserwerk";
  t[42] = "Glasfasernetz";
  t[4] = "Einkommensteuer";
  t[49] = "Solidaritätszuschlag";
  for (const i of [7, 24, 28, 45]) {
    t[i] = "Postkarte";
  }
  for (const i of [2, 21, 37]) {
    t[i] = "Bundesland";
  }
  return t;
}

const tileNames = layout();
const m = (n: number) => `${n} €`;

export const de: Theme = {
  id: "de",
  name: "Deutschland",
  flag: "🇩🇪",
  locale: "de-DE",
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
    "Ruhrgebiet",
    "Leipzig",
    "Dresden",
    "Köln",
    "Frankfurt",
    "Hamburg",
    "Stuttgart",
    "München",
    "Berlin",
    "Berlin Mitte",
  ],
  cardTexts: {
    "ch-go": `In geliehener Pilotenuniform: Fliege direkt zum Abflug und kassiere ${m(200)}.`,
    "ch-g9-last": `Als Graf von und zu Nirgendwo zum Empfang geladen: Reise weiter nach ${tileNames[51]}. Kommst du dabei am Abflug vorbei, kassierst du ${m(200)}.`,
    "ch-g6-first": `Schwäbische Maultaschen rufen: Reise weiter nach ${tileNames[33]}. Kommst du dabei am Abflug vorbei, kassierst du ${m(200)}.`,
    "ch-g3-first": `Kölsch-Pause im Rheinland: Reise weiter nach ${tileNames[14]}. Kommst du dabei am Abflug vorbei, kassierst du ${m(200)}.`,
    "ch-station-1": `Falscher Schaffner: Reise weiter nach ${tileNames[5]}. Kommst du dabei am Abflug vorbei, kassierst du ${m(200)}.`,
    "ch-nearest-station":
      "Fahre zum nächsten Bahnhof. Hat er einen Besitzer, zahle ihm die doppelte Miete (Zug fällt aus, Ersatzverkehr kostet extra).",
    "ch-nearest-station-2":
      "Deine Deutsche Bahn hat Verspätung wegen Wagenreihungsänderung: Fahre zum nächsten Bahnhof und zahle dem Besitzer die doppelte Miete.",
    "ch-nearest-utility":
      "Falscher Zählerableser: Fahre zum nächsten Werk. Hat es einen Besitzer, würfle und zahle ihm das Zehnfache der Augenzahl.",
    "ch-back-3": "Baustelle auf der A3, Umleitung: Gehe 3 Felder zurück.",
    "ch-jail": "Du hast in der Mittagsruhe den Rasen gemäht: Aufgeflogen! Ab in die U-Haft.",
    "ch-jail-card":
      "Die Polizei kauft dir die Geschichte vom bösen Zwilling ab: Hebe die Karte auf. In der U-Haft spielst du sie aus und bist sofort frei.",
    "ch-dividend": `Dividende deiner Bernsteinzimmer-Suche GmbH: Du erhältst ${m(50)}.`,
    "ch-loan": `Du verkaufst Schloss Neuschwanstein, schon wieder: Du erhältst ${m(150)}.`,
    "ch-speeding": `Geblitzt mit Klebebart, das Foto ist trotzdem scharf: Bussgeld ${m(15)}.`,
    "ch-chairman": `Als angeblicher Lottomillionär gibst du eine Runde aus: Zahle jedem Mitspieler ${m(50)} fürs Bier.`,
    "ch-repairs": `Die Hausverwaltung schickt die Nebenkostenabrechnung: ${m(25)} pro Haus, ${m(100)} pro Hotel, ${m(200)} pro Wolkenkratzer.`,
    "cc-go": `Upgrade dank erfundenem Adelstitel: Fliege direkt zum Abflug und kassiere ${m(200)}.`,
    "cc-bank-error": `Die Bank verwechselt dich mit einem Grafen gleichen Namens: Du erhältst ${m(200)}.`,
    "cc-doctor": `Arztrechnung nach dem Oktoberfest: Zahle ${m(50)}.`,
    "cc-stock": `Du verkaufst Aktien deiner Briefkastenfirma in Frankfurt: Du erhältst ${m(50)}.`,
    "cc-jail-card":
      "Der ganze Kegelclub schwört, du warst beim Kegeln: Hebe die Karte auf. In der U-Haft spielst du sie aus und bist sofort frei.",
    "cc-jail": "Falsch getrennter Müll in der Gelben Tonne: Aufgeflogen! Ab in die U-Haft.",
    "cc-holiday": `Falscher Stadtführer in der Speicherstadt: Du erhältst ${m(100)}.`,
    "cc-tax-refund": `Das Finanzamt glaubt dir das Arbeitszimmer im Schloss: Du erhältst ${m(20)}.`,
    "cc-birthday": `Dritter Geburtstag in diesem Jahr: Jeder Mitspieler schenkt dir ${m(10)} und ein Stück Kuchen.`,
    "cc-insurance": `Die Versicherung ersetzt deine „antike“ Kuckucksuhr: Du erhältst ${m(100)}.`,
    "cc-hospital": `Falscher Chefarzt, echte Nebenwirkungen: Zahle ${m(100)}.`,
    "cc-school": `Gebühr für deinen Doktortitel aus dem Copyshop: Zahle ${m(50)}.`,
    "cc-consultancy": `Honorar als falscher KI-Guru für ein Berliner Start-up: Du erhältst ${m(25)}.`,
    "cc-street-repairs": `Die Stadt saniert die Strassen: Zahle ${m(40)} pro Haus, ${m(115)} pro Hotel und ${m(250)} pro Wolkenkratzer.`,
    "cc-beauty": `Du gewinnst den zweiten Preis beim Kartoffelsalat-Wettbewerb: Du erhältst ${m(10)}.`,
    "cc-inherit": `Deine Tante aus Bayern (sagst du) hinterlässt dir ${m(100)}.`,
  },
  deckNames: { chance: "Postkarte", community: "Bundesland" },
  lender: "Der Privatbankier im Frankfurter Westend",
  botNames: [
    "Klaus Kartoffel",
    "Helga Brezel",
    "Jürgen Currywurst",
    "Uschi Autobahn",
    "Dieter Dackel",
    "Gisela Gartenzwerg",
    "Horst Hefeweizen",
    "Bärbel Bratwurst",
  ],
  tokens: [
    { id: "pretzel", name: "Brezel" },
    { id: "beer-stein", name: "Bierkrug" },
    { id: "beetle-car", name: "Käfer" },
    { id: "cuckoo-clock", name: "Kuckucksuhr" },
    { id: "garden-gnome", name: "Gartenzwerg" },
    { id: "bratwurst", name: "Bratwurst" },
    { id: "pickelhaube", name: "Pickelhaube" },
    { id: "train", name: "ICE" },
  ],
  i18n: {
    en: {
      name: "Germany",
      groupNames: [
        "Ruhr Area",
        "Leipzig",
        "Dresden",
        "Cologne",
        "Frankfurt",
        "Hamburg",
        "Stuttgart",
        "Munich",
        "Berlin",
        "Berlin Mitte",
      ],
      deckNames: { chance: "Postcard", community: "Federal state" },
      tokenNames: {
        pretzel: "Pretzel",
        "beer-stein": "Beer Stein",
        "beetle-car": "Beetle",
        "cuckoo-clock": "Cuckoo Clock",
        "garden-gnome": "Garden Gnome",
        bratwurst: "Bratwurst",
        pickelhaube: "Pickelhaube",
        train: "ICE Train",
      },
      cardTexts: {
        "ch-go": `In a borrowed pilot's uniform: Fly straight to Abflug and collect ${m(200)}.`,
        "ch-g9-last": `Invited to a reception as the Count of Nowhere: Travel on to ${tileNames[51]}. Passing Abflug on the way pays ${m(200)}.`,
        "ch-g6-first": `Swabian Maultaschen are calling: Travel on to ${tileNames[33]}. Passing Abflug on the way pays ${m(200)}.`,
        "ch-g3-first": `Kölsch break in the Rhineland: Travel on to ${tileNames[14]}. Passing Abflug on the way pays ${m(200)}.`,
        "ch-station-1": `Fake ticket inspector: Travel on to ${tileNames[5]}. Passing Abflug on the way pays ${m(200)}.`,
        "ch-nearest-station":
          "Head for the nearest station. If it has an owner, pay the owner twice the rent (train cancelled, replacement bus costs extra).",
        "ch-nearest-station-2":
          "Your Deutsche Bahn is delayed because of a change in carriage order: Head for the nearest station and pay the owner twice the rent.",
        "ch-nearest-utility":
          "Fake meter reader: Head for the nearest utility. If it has an owner, roll the dice and pay the owner ten times the number rolled.",
        "ch-back-3": "Roadworks on the A3, detour: Go back 3 spaces.",
        "ch-jail": "You mowed the lawn during the midday quiet hours: Busted! Straight to custody.",
        "ch-jail-card":
          "The police buy your evil-twin story: Hold on to this card. If you land in custody, play it to walk free at once.",
        "ch-dividend": `Dividend from your Amber Room Search Ltd: You receive ${m(50)}.`,
        "ch-loan": `You sell Neuschwanstein Castle, again: You receive ${m(150)}.`,
        "ch-speeding": `Speed camera, stick-on beard, still a sharp photo: Fine ${m(15)}.`,
        "ch-chairman": `As a self-styled lottery millionaire, you buy a round: Pay each player ${m(50)} for the beer.`,
        "ch-repairs": `The property management sends the service charge statement: ${m(25)} per house, ${m(100)} per hotel, ${m(200)} per skyscraper.`,
        "cc-go": `Upgraded thanks to a made-up title: Fly straight to Abflug and collect ${m(200)}.`,
        "cc-bank-error": `The bank mixes you up with a count of the same name: You receive ${m(200)}.`,
        "cc-doctor": `Doctor's bill after the Oktoberfest: Pay ${m(50)}.`,
        "cc-stock": `You sell shares in your Frankfurt letterbox company: You receive ${m(50)}.`,
        "cc-jail-card":
          "The whole bowling club swears you were there: Hold on to this card. If you land in custody, play it to walk free at once.",
        "cc-jail": "Wrongly sorted waste in the yellow bin: Busted! Straight to custody.",
        "cc-holiday": `Fake tour guide in the Speicherstadt: You receive ${m(100)}.`,
        "cc-tax-refund": `The tax office accepts your home office in a castle: You receive ${m(20)}.`,
        "cc-birthday": `Your third birthday this year: Every player gives you ${m(10)} and a piece of cake.`,
        "cc-insurance": `The insurer replaces your “antique” cuckoo clock: You receive ${m(100)}.`,
        "cc-hospital": `Fake chief physician, real side effects: Pay ${m(100)}.`,
        "cc-school": `Fee for your copy-shop doctorate: Pay ${m(50)}.`,
        "cc-consultancy": `Fee as a fake AI guru for a Berlin start-up: You receive ${m(25)}.`,
        "cc-street-repairs": `The city renovates the streets: Pay ${m(40)} per house, ${m(115)} per hotel and ${m(250)} per skyscraper.`,
        "cc-beauty": `You win second prize in the potato salad contest: You receive ${m(10)}.`,
        "cc-inherit": `Your aunt from Bavaria (so you claim) leaves you ${m(100)}.`,
      },
    },
  },
  securities: DE_SECURITIES,
  scenicGroups: [5, 7],
  environment: "berlin",
  landmark: "landmark-brandenburg",
  skyscraperModels: { 9: "skyscraper-fernsehturm" },
};
