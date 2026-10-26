// Luzernerdeutsch (gsw). Übersetzt mit GPT via Codex-CLI, geprüft mit scripts/i18n/import-gsw.ts.
import type { ThemeTexts } from "../theme-types.ts";

export const GSW_THEME_TEXTS: Record<string, ThemeTexts> = {
  ch: {
    name: "Schwiiz",
    groupNames: [
      "Graubünden",
      "Lozärn",
      "Basel",
      "Bärn",
      "Tessin",
      "Waadt",
      "Genève",
      "Zug",
      "Engadin",
      "Zürich",
    ],
    deckNames: {
      chance: "Poschtcharte",
      community: "Kanton",
    },
    tokenNames: {
      cow: "Chue",
      "swiss-knife": "Sackmesser",
      cheese: "Chäs",
      watch: "Uhr",
      chocolate: "Schoggi",
      "st-bernard": "Bernhardiner",
      fondue: "Fondue-Chacheli",
      gondola: "Gondelbahn",
    },
    cardTexts: {
      "ch-go": "De Zug fahrt usnahmswiis pünktlich: Flüg direkt zum Abflug und chassier CHF 200.",
      "ch-g9-last":
        "Als falsche Privatbankier im usglehnte Nadelstreifeanzug: Reis wiiter nach Paradeplatz. Chunsch debii am Abflug verbii, chassiersch du CHF 200.",
      "ch-g6-first":
        "Als falsche Diplomat am Empfang am See: Reis wiiter nach Place du Molard. Chunsch debii am Abflug verbii, chassiersch du CHF 200.",
      "ch-g3-first":
        "Mit emne bastlete Bundeshuus-Uuswiis: Reis wiiter nach Kramgasse. Chunsch debii am Abflug verbii, chassiersch du CHF 200.",
      "ch-station-1":
        "Falsche Kondüktör: Reis wiiter nach Zürich HB. Chunsch debii am Abflug verbii, chassiersch du CHF 200.",
      "ch-nearest-station":
        "Fahr zom nöchste Bahnhof. Het er en Bsitzer, zahl em s Doppelte vo de Miet (de Aaschluss isch natürli wieder z spot cho).",
      "ch-nearest-station-2":
        "D SBB meldet Verspötig uf Gleis 3: Fahr zom nöchste Bahnhof und zahl em Bsitzer die doppleti Miet.",
      "ch-nearest-utility":
        "Falsche Stromableser: Fahr zom nöchste Werk. Het s en Bsitzer, würfle und zahl em s Zähfache vo de Augenzahl.",
      "ch-back-3": "Röstigrabe-Navigation: Gang 3 Fälder zrogg.",
      "ch-jail": "S Palace z Gstaad merkt, dass du kei Maharadscha bisch: Uufgfloge! Ab id U-Haft.",
      "ch-jail-card":
        "Alibi: es Foti vor de Matterhorn-Fototapete. Heb d Charte uf. Wennd i de U-Haft bisch, spill sie uus und bisch sofort frei.",
      "ch-dividend": "Dividende vo dinere Matterhorn-Rolltreppe AG: CHF 50.",
      "ch-loan": "Du verchaufsch d Uussicht vom Pilatus zum zwöite Mal: Du bechunsch CHF 150.",
      "ch-speeding": "Radar am Gotthard, Diplomate-Nummere us Karton: Busse CHF 15.",
      "ch-chairman":
        "Als falsche Uhre-Erb us Biel ladsch zum Apéro ii: Zahl jedem Mitspieler CHF 50.",
      "ch-repairs":
        "Dini Kulisse-Chalets bruuched früschi Farb: CHF 25 pro Huus, CHF 100 pro Hotel, CHF 200 pro Wolkenkratzer.",
      "cc-go": "D Gmeindsversammlig isch fertig: Flüg direkt zum Abflug und chassier CHF 200.",
      "cc-bank-error":
        "D Bank überwiist der versehentlich z vill (chunnt i de Schwiiz sälte vor!): Du bechunsch CHF 200.",
      "cc-doctor": "Arzträchnig, d Franchise laht grüesse: Zahl CHF 50.",
      "cc-stock": "Du verchaufsch Aateil a nere Goldmine im Säntis: Du bechunsch CHF 50.",
      "cc-jail-card":
        "Dini Seilschaft schwört, du sigsch am Bärg gsi: Heb d Charte uf. Wennd i de U-Haft bisch, spill sie uus und bisch sofort frei.",
      "cc-jail": "Alphornprobe ohni Bewilligung im Wohnquartier: Uufgfloge! Ab id U-Haft.",
      "cc-holiday": "Es Grotto im Tessin haltet di für de Gastrokritiker: Du bechunsch CHF 100.",
      "cc-tax-refund": "S Stüüramt glaubt der de Wohnsitz z Zug: Du bechunsch CHF 20.",
      "cc-birthday":
        "Hüt hesch (scho wieder) Geburtstag: Jede Mitspiler schenkt der CHF 10 und e Schoggi.",
      "cc-insurance": "D Versicherig ersetzt dini «antiki» Flohmärt-Uhr: Du bechunsch CHF 100.",
      "cc-hospital": "Spitalköste, d Krankekasseprämie stigt scho wieder: Zahl CHF 100.",
      "cc-school": "Echte Kurs für dis falsche Skilehrer-Patent z Zermatt: Zahl CHF 50.",
      "cc-consultancy": "E Zuger Firma zahlt di als «Krypto-Experte»: Du bechunsch CHF 25.",
      "cc-street-repairs":
        "De Kanton saniert d Strasse: Zahl CHF 40 pro Huus, CHF 115 pro Hotel und CHF 250 pro Wolkenkratzer.",
      "cc-beauty": "Du gwönnsch de Chäs-Schönheitswettbewerb (zweite Platz): Du bechunsch CHF 10.",
      "cc-inherit": "Dini nagelneui Grosstante us em Emmental hinterlaht der CHF 100.",
    },
  },
  fr: {
    name: "Frankriich",
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
    deckNames: {
      chance: "Poschtcharte",
      community: "Mairie",
    },
    tokenNames: {
      baguette: "Baguette",
      beret: "Baskemüetze",
      rooster: "Gallische Güggel",
      croissant: "Croissant",
      "wine-bottle": "Wiflasche",
      eiffel: "Eiffelturm",
      scooter: "Roller",
      perfume: "Parfümfläsche",
    },
    cardTexts: {
      "ch-go": "Trotz Streik fahrt de Zug: Flüg direkt zum Embarquement und chassier 200 €.",
      "ch-g9-last":
        "Reis wiiter nach Champs-Élysées und gib di als Erb vomne Parfümhuus uus. Chunsch debii am Embarquement verbii, chassiersch du 200 €.",
      "ch-g6-first":
        "Croissant-Pause am linke Seine-Ufer: Reis wiiter nach Rue Mouffetard. Chunsch debii am Embarquement verbii, chassiersch du 200 €.",
      "ch-g3-first":
        "Reis wiiter nach Vieux Lyon und bschtell es Bouchon-Menü. Chunsch debii am Embarquement verbii, chassiersch du 200 €.",
      "ch-station-1":
        "Mit gmoletem Billett: Reis wiiter nach Gare du Nord. Chunsch debii am Embarquement verbii, chassiersch du 200 €.",
      "ch-nearest-station":
        "Fahr zom nöchste Bahnhof. Het er en Bsitzer, zahl em s Doppelte vo de Miet (TGV, natürli mit Reservation).",
      "ch-nearest-station-2":
        "D SNCF meldet en Streik, du nimmsch de nöchste Bahnhof: Fahr häre und zahl em Bsitzer die doppleti Miet.",
      "ch-nearest-utility":
        "Falsche Zählerableser: Fahr zom nöchste Werk. Het s en Bsitzer, würfle und zahl em s Zähfache vo de Augenzahl.",
      "ch-back-3": "Am Kreisel bim Arc de Triomphe verfahre: Gang 3 Fälder zrogg.",
      "ch-jail": "En Zöllner kennt di vom Fahndigsplakat: Uufgfloge! Ab id Garde à vue.",
      "ch-jail-card":
        "De Kommissar glaubt der, dass du nur Pantomime gübt hesch: Heb d Charte uf. Wennd i de U-Haft bisch, spill sie uus und bisch sofort frei.",
      "ch-dividend": "Dividende us dim Wiigut (ei Chischte): Du bechunsch 50 €.",
      "ch-loan": "Du verchaufsch de Eiffelturm, das Mal nur d Hälfti: Du bechunsch 150 €.",
      "ch-speeding": "Blitzer uf em Périphérique: Busse 15 €.",
      "ch-chairman":
        "Im Casino vo Nizza gisch di als Graf uus: Zahl jedem Mitspieler 50 € für de Champagner.",
      "ch-repairs":
        "D Kartonfassade vo dim Loire-Schloss bruucht Farb: 25 € pro Huus, 100 € pro Hotel, 200 € pro Wolkenkratzer.",
      "cc-go":
        "Mit ere Kapitänsmütze vom Flohmärt: Flüg direkt zum Embarquement und chassier 200 €.",
      "cc-bank-error": "D Bank verwächslet di mit emne Baron us Bordeaux: Du bechunsch 200 €.",
      "cc-doctor": "Arzträchnig nach z vill Foie gras: Zahl 50 €.",
      "cc-stock": "Du verchaufsch Aktie vo nere Trüffelmine im Périgord: Du bechunsch 50 €.",
      "cc-jail-card":
        "S ganze Bistro schwört, du sigsch a de Theke gsi: Heb d Charte uf. Wennd i de U-Haft bisch, spill sie uus und bisch sofort frei.",
      "cc-jail": "Du hesch Tetrapak-Wii als Grand Cru verchauft: Uufgfloge! Ab id Garde à vue.",
      "cc-holiday": "Congés payés: Din Ferielohn beträgt 100 €.",
      "cc-tax-refund": "S Finanzamt haltet dini Jacht für es Fischerboot: Du bechunsch 20 €.",
      "cc-birthday":
        "Laut dim dritte Pass hesch hüt Geburtstag: Jede Mitspiler schenkt der 10 € und es Pain au chocolat.",
      "cc-insurance": "D Versicherig zahlt dis «Original» vom Montmartre: Du bechunsch 100 €.",
      "cc-hospital": "Falsche Film-Double, echte Gips: Zahl 100 €.",
      "cc-school": "Nachhilf für dis falsche Sorbonne-Diplom: Zahl 50 €.",
      "cc-consultancy": "Honorar als falsche Parfüm-Experte (mit Pfnüsel): Du bechunsch 25 €.",
      "cc-street-repairs":
        "D Stadt saniert d Pflasterstei: Zahl 40 € pro Huus, 115 € pro Hotel und 250 € pro Wolkenkratzer.",
      "cc-beauty":
        "Du gwönnsch de zweite Priis bim Chäs-Wettbewerb (Camembert): Du bechunsch 10 €.",
      "cc-inherit": "E wildfrömdi Tante us de Provence vererbt der 100 €.",
    },
  },
  de: {
    name: "Dütschland",
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
    deckNames: {
      chance: "Poschtcharte",
      community: "Bundesland",
    },
    tokenNames: {
      pretzel: "Bretzel",
      "beer-stein": "Bierkrueg",
      "beetle-car": "Chäfer",
      "cuckoo-clock": "Guggeruhr",
      "garden-gnome": "Gartazwerg",
      bratwurst: "Bratwurscht",
      pickelhaube: "Pickelhaube",
      train: "ICE",
    },
    cardTexts: {
      "ch-go": "I usglehnter Pilote-Uniform: Flüg direkt zum Abflug und chassier 200 €.",
      "ch-g9-last":
        "Als Graf vo und zu Niene zum Empfang iiglade: Reis wiiter nach Pariser Platz. Chunsch debii am Abflug verbii, chassiersch du 200 €.",
      "ch-g6-first":
        "Schwäbischi Maultäsche rüefed: Reis wiiter nach Calwer Strasse. Chunsch debii am Abflug verbii, chassiersch du 200 €.",
      "ch-g3-first":
        "Kölsch-Pause im Rheinland: Reis wiiter nach Hohe Strasse. Chunsch debii am Abflug verbii, chassiersch du 200 €.",
      "ch-station-1":
        "Falsche Kondüktör: Reis wiiter nach Hauptbahnhof Berlin. Chunsch debii am Abflug verbii, chassiersch du 200 €.",
      "ch-nearest-station":
        "Fahr zom nöchste Bahnhof. Het er en Bsitzer, zahl em s Doppelte vo de Miet (Zug fallt uus, Ersatzverkehr choschtet extra).",
      "ch-nearest-station-2":
        "D Deutsche Bahn het Verspötig wäge ere Änderig vo de Wage-Reihfolg: Fahr zom nöchste Bahnhof und zahl em Bsitzer die doppleti Miet.",
      "ch-nearest-utility":
        "Falsche Zählerableser: Fahr zom nöchste Werk. Het s en Bsitzer, würfle und zahl em s Zähfache vo de Augenzahl.",
      "ch-back-3": "Baustell uf de A3, Umleitig: Gang 3 Fälder zrogg.",
      "ch-jail": "Du hesch i de Mittagsrueh de Rase gmäit: Uufgfloge! Ab id U-Haft.",
      "ch-jail-card":
        "D Polizei chauft der d Gschicht vom böse Zwilling ab: Heb d Charte uf. Wennd i de U-Haft bisch, spill sie uus und bisch sofort frei.",
      "ch-dividend": "Dividende vo dinere Bernsteinzimmer-Suech GmbH: Du bechunsch 50 €.",
      "ch-loan": "Du verchaufsch s Schloss Neuschwanstein, scho wieder: Du bechunsch 150 €.",
      "ch-speeding": "Blitzt mit Chläbbart, s Foti isch glich scharf: Busse 15 €.",
      "ch-chairman":
        "Als aagebliche Lottomillionär zahlsch e Rundi: Zahl jedem Mitspieler 50 € fürs Bier.",
      "ch-repairs":
        "D Huusverwaltig schickt d Nebechöste-Rächnig: 25 € pro Huus, 100 € pro Hotel, 200 € pro Wolkenkratzer.",
      "cc-go": "Besseri Klass dank falschem Adelstitel: Flüg direkt zum Abflug und chassier 200 €.",
      "cc-bank-error": "D Bank verwächslet di mit emne Graf, wo gliich heisst: Du bechunsch 200 €.",
      "cc-doctor": "Arzträchnig nach em Oktoberfest: Zahl 50 €.",
      "cc-stock":
        "Du verchaufsch Aktie vo dinere Briefchaschtefirma z Frankfurt: Du bechunsch 50 €.",
      "cc-jail-card":
        "De ganz Kegelclub schwört, du sigsch go kegle gsi: Heb d Charte uf. Wennd i de U-Haft bisch, spill sie uus und bisch sofort frei.",
      "cc-jail": "Müll falsch i de Gelbe Tonne trenne: Uufgfloge! Ab id U-Haft.",
      "cc-holiday": "Falsche Stadtfüehrer i de Speicherstadt: Du bechunsch 100 €.",
      "cc-tax-refund": "S Finanzamt glaubt der s Arbeitszimmer im Schloss: Du bechunsch 20 €.",
      "cc-birthday":
        "Dritte Geburtstag i däm Johr: Jede Mitspiler schenkt der 10 € und es Stück Chueche.",
      "cc-insurance": "D Versicherig ersetzt dini «antiki» Kuckucksuhr: Du bechunsch 100 €.",
      "cc-hospital": "Falsche Chefarzt, echti Nebewürkige: Zahl 100 €.",
      "cc-school": "Gebühr für din Doktertitel us em Kopierlade: Zahl 50 €.",
      "cc-consultancy":
        "Honorar als falsche KI-Guru für es Berliner Jungunternähme: Du bechunsch 25 €.",
      "cc-street-repairs":
        "D Stadt saniert d Strasse: Zahl 40 € pro Huus, 115 € pro Hotel und 250 € pro Wolkenkratzer.",
      "cc-beauty": "Du gwönnsch de zweite Priis bim Härdöpfelsalat-Wettbewerb: Du bechunsch 10 €.",
      "cc-inherit": "Dini Tante us Bayern (seisch du) hinterlaht der 100 €.",
    },
  },
  it: {
    name: "Italiä",
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
    deckNames: {
      chance: "Poschtcharte",
      community: "Comune",
    },
    tokenNames: {
      vespa: "Vespa",
      pizza: "Pizza",
      espresso: "Espresso",
      "gondola-venice": "Gondle",
      colosseum: "Kolosseum",
      pasta: "Pasta",
      gelato: "Glacé",
      "tower-pisa": "Schiefe Turm",
    },
    cardTexts: {
      "ch-go":
        "Im Pilotechostüm vom Karneval z Venedig: Flüg direkt zum Imbarco und chassier 200 €.",
      "ch-g9-last":
        "En Juwelier haltet di für en Principe: Reis wiiter nach Via Condotti. Chunsch debii am Imbarco verbii, chassiersch du 200 €.",
      "ch-g6-first":
        "Luscht uf Pesto: Reis wiiter nach Via del Campo. Chunsch debii am Imbarco verbii, chassiersch du 200 €.",
      "ch-g3-first":
        "Gianduiotto-Pause im Piemont: Reis wiiter nach Via Po. Chunsch debii am Imbarco verbii, chassiersch du 200 €.",
      "ch-station-1":
        "Gfälschts Gratisbillett: Reis wiiter nach Roma Termini. Chunsch debii am Imbarco verbii, chassiersch du 200 €.",
      "ch-nearest-station":
        "Fahr zom nöchste Bahnhof. Het er en Bsitzer, zahl em s Doppelte vo de Miet (wäge sciopero).",
      "ch-nearest-station-2":
        "Trenitalia het scho wieder Verspötig: Fahr zom nöchste Bahnhof und zahl em Bsitzer die doppleti Miet.",
      "ch-nearest-utility":
        "Falsche Zählerableser: Fahr zom nöchste Werk. Het s en Bsitzer, würfle und zahl em s Zähfache vo de Augenzahl.",
      "ch-back-3": "Im Kreisel falsch abboge: Gang 3 Fälder zrogg.",
      "ch-jail": "Dis Gondoliere-Patent isch es Souvenir: Uufgfloge! Ab id Questura.",
      "ch-jail-card":
        "D Carabinieri glaubed der, das sig en Dreh für Cinecittà: Heb d Charte uf. Wennd i de U-Haft bisch, spill sie uus und bisch sofort frei.",
      "ch-dividend": "Dividende us diner Olivenölfirma (ei Baum, ei Fläsche): Du bechunsch 50 €.",
      "ch-loan": "Du verchaufsch d Fontana di Trevi zum zwöite Mal: Du bechunsch 150 €.",
      "ch-speeding": "Autovelox uf de Autostrada: Busse 15 €.",
      "ch-chairman":
        "Im Casinò vo Sanremo spielsch de Conte: Zahl jedem Mitspieler 50 € für de Espresso.",
      "ch-repairs":
        "De Condominio schickt d Rächnig: 25 € pro Huus, 100 € pro Hotel, 200 € pro Wolkenkratzer.",
      "cc-go": "Flüg direkt zum Imbarco und chassier 200 €. Andiamo!",
      "cc-bank-error": "D Bank verwächslet di mit emne Conte us Florenz: Du bechunsch 200 €.",
      "cc-doctor": "Arzträchnig nach z vill Tiramisù: Zahl 50 €.",
      "cc-stock":
        "Du verchaufsch Aktie vo dinere Spaghetti-Plantage am Comersee: Du bechunsch 50 €.",
      "cc-jail-card":
        "Alli Nonnas schwöred, du sigsch bim Sunntigsässe gsi: Heb d Charte uf. Wennd i de U-Haft bisch, spill sie uus und bisch sofort frei.",
      "cc-jail": "Du hesch s Kolosseum als Feriewohnig vermietet: Uufgfloge! Ab id Questura.",
      "cc-holiday": "Capri haltet di für en Filmschauspieler: Du bechunsch 100 €.",
      "cc-tax-refund": "Stüürerückerstattig vom Finanzamt (es Wunder): Du bechunsch 20 €.",
      "cc-birthday":
        "Namenstag für jede vo dine falsche Näme: Jede Mitspiler schenkt der 10 € und es Stück Torta.",
      "cc-insurance": "D Versicherig ersetzt dini «antiki» Kiosk-Amphore: Du bechunsch 100 €.",
      "cc-hospital": "Falsche Tenor, echts Halsweh: Zahl 100 €.",
      "cc-school": "Chochkurs für de falsch Sternechoch: Zahl 50 €.",
      "cc-consultancy": "Honorar als falsche Stilberater z Mailand: Du bechunsch 25 €.",
      "cc-street-repairs":
        "D Gmeind saniert d Pflasterstei: Zahl 40 € pro Huus, 115 € pro Hotel und 250 € pro Wolkenkratzer.",
      "cc-beauty": "Du gwönnsch de zweite Priis bim Glacé-Wettbewerb: Du bechunsch 10 €.",
      "cc-inherit": "E Nonna us de Toskana haltet di für ihre Enkel: Du erbsch 100 €.",
    },
  },
};
