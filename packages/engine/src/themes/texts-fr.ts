// French theme texts (docs/DESIGN.md #76). Space names stay local (decision #31); card texts, group, deck and
// token names are translated. Money and space names are taken from the theme so the amounts cannot drift.
import type { Theme, ThemeTexts } from "../theme-types.ts";
import { ch } from "./ch.ts";
import { de } from "./de.ts";
import { fr } from "./fr.ts";
import { it } from "./it.ts";

const chf = (n: number) => `CHF ${n}`;
const eur = (n: number) => `${n} €`;
const tiles = (theme: Theme) => theme.tileNames;

const CH: ThemeTexts = (() => {
  const t = tiles(ch);
  const m = chf;
  return {
    name: "Suisse",
    groupNames: [
      "Grisons",
      "Lucerne",
      "Bâle",
      "Berne",
      "Tessin",
      "Vaud",
      "Genève",
      "Zoug",
      "Engadine",
      "Zurich",
    ],
    deckNames: { chance: "Carte postale", community: "Canton" },
    tokenNames: {
      cow: "Vache",
      "swiss-knife": "Couteau suisse",
      cheese: "Fromage",
      watch: "Montre",
      chocolate: "Chocolat",
      "st-bernard": "Saint-Bernard",
      fondue: "Caquelon à fondue",
      gondola: "Télécabine",
    },
    cardTexts: {
      "ch-go": `Le train est exceptionnellement à l'heure : rends-toi directement à la case Abflug et reçois ${m(200)}.`,
      "ch-g9-last": `Ton conseiller bancaire t'invite : poursuis ton voyage jusqu'à ${t[51]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-g6-first": `Envie de fondue au bord du lac : poursuis ton voyage jusqu'à ${t[33]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-g3-first": `Sortie politique : poursuis ton voyage jusqu'à ${t[14]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-station-1": `Poursuis ton voyage jusqu'à ${t[5]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-nearest-station":
        "Rends-toi à la gare la plus proche. Si elle a un propriétaire, paie-lui le double du loyer (la correspondance était évidemment encore en retard).",
      "ch-nearest-station-2":
        "Les CFF annoncent un retard voie 3 : rends-toi à la gare la plus proche et paie le double du loyer au propriétaire.",
      "ch-nearest-utility":
        "Rends-toi au service public le plus proche. S'il a un propriétaire, lance les dés et paie-lui dix fois le résultat.",
      "ch-back-3": "Navigation à la Röstigraben : recule de 3 cases.",
      "ch-jail": "Tapage nocturne après 22 h : tu es démasqué ! Direction la garde à vue.",
      "ch-jail-card":
        "Le piston, ça marche : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "ch-dividend": `La banque te verse un dividende : ${m(50)}.`,
      "ch-loan": `Ton contrat d'épargne-logement arrive à échéance : tu reçois ${m(150)}.`,
      "ch-speeding": `Radar sur la route du Gothard : amende de ${m(15)}.`,
      "ch-chairman": `Tu es élu président du conseil d'administration. Paie ${m(50)} à chaque joueur pour l'apéro.`,
      "ch-repairs": `L'association des propriétaires envoie la facture : ${m(25)} par maison, ${m(100)} par hôtel, ${m(200)} par gratte-ciel.`,
      "cc-go": `Assemblée communale terminée : rends-toi directement à la case Abflug et reçois ${m(200)}.`,
      "cc-bank-error": `La banque te vire une somme par erreur (rare en Suisse !) : tu reçois ${m(200)}.`,
      "cc-doctor": `Facture du médecin, la franchise te dit bonjour : paie ${m(50)}.`,
      "cc-stock": `Tu vends des actions à la SIX : tu reçois ${m(50)}.`,
      "cc-jail-card":
        "Un alibi en béton : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "cc-jail":
        "Répétition de cor des Alpes non autorisée dans un quartier résidentiel : tu es démasqué ! Direction la garde à vue.",
      "cc-holiday": `Ton fonds de vacances est versé : tu reçois ${m(100)}.`,
      "cc-tax-refund": `Remboursement d'impôts du canton : tu reçois ${m(20)}.`,
      "cc-birthday": `C'est ton anniversaire : chaque joueur t'offre ${m(10)} et un chocolat.`,
      "cc-insurance": `Ton assurance-vie arrive à échéance : tu reçois ${m(100)}.`,
      "cc-hospital": `Frais d'hôpital, les primes d'assurance-maladie augmentent encore : paie ${m(100)}.`,
      "cc-school": `Frais de scolarité de l'école privée du Zürichberg : paie ${m(50)}.`,
      "cc-consultancy": `Honoraires de conseil pour un mandat fiduciaire : tu reçois ${m(25)}.`,
      "cc-street-repairs": `Le canton rénove les routes : paie ${m(40)} par maison, ${m(115)} par hôtel et ${m(250)} par gratte-ciel.`,
      "cc-beauty": `Tu remportes la deuxième place du concours de beauté du fromage : tu reçois ${m(10)}.`,
      "cc-inherit": `Ta grand-tante de l'Emmental te lègue ${m(100)}.`,
    },
  };
})();

const FR: ThemeTexts = (() => {
  const t = tiles(fr);
  const m = eur;
  return {
    name: "France",
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
    deckNames: { chance: "Carte postale", community: "Mairie" },
    tokenNames: {
      baguette: "Baguette",
      beret: "Béret",
      rooster: "Coq gaulois",
      croissant: "Croissant",
      "wine-bottle": "Bouteille de vin",
      eiffel: "Tour Eiffel",
      scooter: "Scooter",
      perfume: "Flacon de parfum",
    },
    cardTexts: {
      "ch-go": `Malgré la grève, le train roule : rends-toi directement à la case Embarquement et reçois ${m(200)}.`,
      "ch-g9-last": `Poursuis ton voyage jusqu'à ${t[51]}, là où l'on voit et où l'on est vu. En repassant par la case Embarquement, tu touches ${m(200)}.`,
      "ch-g6-first": `Pause croissant sur la Rive Gauche : poursuis ton voyage jusqu'à ${t[33]}. En repassant par la case Embarquement, tu touches ${m(200)}.`,
      "ch-g3-first": `Poursuis ton voyage jusqu'à ${t[14]} et commande un menu de bouchon lyonnais. En repassant par la case Embarquement, tu touches ${m(200)}.`,
      "ch-station-1": `Poursuis ton voyage jusqu'à ${t[5]}. En repassant par la case Embarquement, tu touches ${m(200)}.`,
      "ch-nearest-station":
        "Rends-toi à la gare la plus proche. Si elle a un propriétaire, paie-lui le double du loyer (TGV, réservation obligatoire bien sûr).",
      "ch-nearest-station-2":
        "La SNCF annonce une grève, tu prends donc la gare la plus proche : rends-toi-y et paie le double du loyer au propriétaire.",
      "ch-nearest-utility":
        "Rends-toi au service public le plus proche. S'il a un propriétaire, lance les dés et paie-lui dix fois le résultat.",
      "ch-back-3": "Tu t'es perdu au rond-point de l'Arc de Triomphe : recule de 3 cases.",
      "ch-jail": "Tu as triché à la pétanque : tu es démasqué ! Direction la garde à vue.",
      "ch-jail-card":
        "Les bonnes relations ouvrent des portes : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "ch-dividend": `Dividende de ton domaine viticole : tu reçois ${m(50)}.`,
      "ch-loan": `Ton prêt bancaire est versé : tu reçois ${m(150)}.`,
      "ch-speeding": `Radar sur le périphérique : amende de ${m(15)}.`,
      "ch-chairman": `Tu es élu président du Club des Boulevards. Paie ${m(50)} à chaque joueur pour le champagne.`,
      "ch-repairs": `La mairie envoie la facture du ravalement de façade : ${m(25)} par maison, ${m(100)} par hôtel, ${m(200)} par gratte-ciel.`,
      "cc-go": `Rends-toi directement à la case Embarquement et reçois ${m(200)}. Vive la France !`,
      "cc-bank-error": `La banque te vire une somme par erreur : tu reçois ${m(200)}.`,
      "cc-doctor": `Note du médecin après trop de foie gras : paie ${m(50)}.`,
      "cc-stock": `Tu vends des actions à la Bourse de Paris : tu reçois ${m(50)}.`,
      "cc-jail-card":
        "Un alibi en béton : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "cc-jail": "Tu n'as pas payé ta baguette : tu es démasqué ! Direction la garde à vue.",
      "cc-holiday": `Congés payés : ta prime de vacances est de ${m(100)}.`,
      "cc-tax-refund": `Remboursement d'impôts du fisc : tu reçois ${m(20)}.`,
      "cc-birthday": `C'est ton anniversaire : chaque joueur t'offre ${m(10)} et un pain au chocolat.`,
      "cc-insurance": `Ton assurance-vie arrive à échéance : tu reçois ${m(100)}.`,
      "cc-hospital": `Frais d'hôpital : paie ${m(100)}.`,
      "cc-school": `Frais de scolarité de la Grande École : paie ${m(50)}.`,
      "cc-consultancy": `Honoraires de conseil pour une start-up parisienne : tu reçois ${m(25)}.`,
      "cc-street-repairs": `La ville rénove les pavés : paie ${m(40)} par maison, ${m(115)} par hôtel et ${m(250)} par gratte-ciel.`,
      "cc-beauty": `Tu remportes le deuxième prix du concours de fromage (camembert) : tu reçois ${m(10)}.`,
      "cc-inherit": `Une tante de Provence te lègue ${m(100)}.`,
    },
  };
})();

const DE: ThemeTexts = (() => {
  const t = tiles(de);
  const m = eur;
  return {
    name: "Allemagne",
    groupNames: [
      "Ruhr",
      "Leipzig",
      "Dresde",
      "Cologne",
      "Francfort",
      "Hambourg",
      "Stuttgart",
      "Munich",
      "Berlin",
      "Berlin-Mitte",
    ],
    deckNames: { chance: "Carte postale", community: "Land" },
    tokenNames: {
      pretzel: "Bretzel",
      "beer-stein": "Chope de bière",
      "beetle-car": "Coccinelle",
      "cuckoo-clock": "Coucou",
      "garden-gnome": "Nain de jardin",
      bratwurst: "Bratwurst",
      pickelhaube: "Casque à pointe",
      train: "Train ICE",
    },
    cardTexts: {
      "ch-go": `Le train est exceptionnellement à l'heure : rends-toi directement à la case Abflug et reçois ${m(200)}.`,
      "ch-g9-last": `Rendez-vous à la Chancellerie : poursuis ton voyage jusqu'à ${t[51]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-g6-first": `Les Maultaschen souabes t'appellent : poursuis ton voyage jusqu'à ${t[33]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-g3-first": `Pause Kölsch en Rhénanie : poursuis ton voyage jusqu'à ${t[14]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-station-1": `Poursuis ton voyage jusqu'à ${t[5]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-nearest-station":
        "Rends-toi à la gare la plus proche. Si elle a un propriétaire, paie-lui le double du loyer (train supprimé, le bus de remplacement coûte en plus).",
      "ch-nearest-station-2":
        "Ta Deutsche Bahn a du retard à cause d'un changement de composition des voitures : rends-toi à la gare la plus proche et paie le double du loyer au propriétaire.",
      "ch-nearest-utility":
        "Rends-toi au service public le plus proche. S'il a un propriétaire, lance les dés et paie-lui dix fois le résultat.",
      "ch-back-3": "Chantier sur l'A3, déviation : recule de 3 cases.",
      "ch-jail":
        "Tu as tondu la pelouse pendant la pause de midi : tu es démasqué ! Direction la garde à vue.",
      "ch-jail-card":
        "Ta réclamation auprès du service de l'ordre public aboutit : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "ch-dividend": `Dividende du DAX : tu reçois ${m(50)}.`,
      "ch-loan": `Ton contrat d'épargne-logement est attribué : tu reçois ${m(150)}.`,
      "ch-speeding": `Radar en zone 30 : amende de ${m(15)}.`,
      "ch-chairman": `Tu es élu président du club. Paie ${m(50)} à chaque joueur pour la bière.`,
      "ch-repairs": `La gérance envoie le décompte des charges : ${m(25)} par maison, ${m(100)} par hôtel, ${m(200)} par gratte-ciel.`,
      "cc-go": `Rends-toi directement à la case Abflug et reçois ${m(200)}.`,
      "cc-bank-error": `La banque te vire une somme par erreur : tu reçois ${m(200)}.`,
      "cc-doctor": `Note du médecin après l'Oktoberfest : paie ${m(50)}.`,
      "cc-stock": `Tu vends des actions à la Bourse de Francfort : tu reçois ${m(50)}.`,
      "cc-jail-card":
        "Un alibi en béton : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "cc-jail":
        "Déchets mal triés dans la poubelle jaune : tu es démasqué ! Direction la garde à vue.",
      "cc-holiday": `Ta prime de vacances est versée : tu reçois ${m(100)}.`,
      "cc-tax-refund": `Remboursement d'impôts du fisc : tu reçois ${m(20)}.`,
      "cc-birthday": `C'est ton anniversaire : chaque joueur t'offre ${m(10)} et une part de gâteau.`,
      "cc-insurance": `Ton assurance-vie arrive à échéance : tu reçois ${m(100)}.`,
      "cc-hospital": `Participation aux frais d'hôpital : paie ${m(100)}.`,
      "cc-school": `Frais de scolarité de l'école privée : paie ${m(50)}.`,
      "cc-consultancy": `Honoraires de conseil pour une start-up berlinoise : tu reçois ${m(25)}.`,
      "cc-street-repairs": `La ville rénove les rues : paie ${m(40)} par maison, ${m(115)} par hôtel et ${m(250)} par gratte-ciel.`,
      "cc-beauty": `Tu remportes le deuxième prix du concours de salade de pommes de terre : tu reçois ${m(10)}.`,
      "cc-inherit": `La tante de Bavière te lègue ${m(100)}.`,
    },
  };
})();

const IT: ThemeTexts = (() => {
  const t = tiles(it);
  const m = eur;
  return {
    name: "Italie",
    groupNames: [
      "Sicile",
      "Naples",
      "Bologne",
      "Turin",
      "Florence",
      "Venise",
      "Ligurie",
      "Capri",
      "Milan",
      "Rome",
    ],
    deckNames: { chance: "Carte postale", community: "Commune" },
    tokenNames: {
      vespa: "Vespa",
      pizza: "Pizza",
      espresso: "Espresso",
      "gondola-venice": "Gondole",
      colosseum: "Colisée",
      pasta: "Pâtes",
      gelato: "Glace",
      "tower-pisa": "Tour penchée",
    },
    cardTexts: {
      "ch-go": `Le train est exceptionnellement à l'heure : rends-toi directement à la case Imbarco et reçois ${m(200)}.`,
      "ch-g9-last": `Aperitivo au cœur de Rome : poursuis ton voyage jusqu'à ${t[51]}. En repassant par la case Imbarco, tu touches ${m(200)}.`,
      "ch-g6-first": `Envie de pesto : poursuis ton voyage jusqu'à ${t[33]}. En repassant par la case Imbarco, tu touches ${m(200)}.`,
      "ch-g3-first": `Pause gianduiotto au Piémont : poursuis ton voyage jusqu'à ${t[14]}. En repassant par la case Imbarco, tu touches ${m(200)}.`,
      "ch-station-1": `Poursuis ton voyage jusqu'à ${t[5]}. En repassant par la case Imbarco, tu touches ${m(200)}.`,
      "ch-nearest-station":
        "Rends-toi à la gare la plus proche. Si elle a un propriétaire, paie-lui le double du loyer (sous réserve de sciopero).",
      "ch-nearest-station-2":
        "Trenitalia a encore du retard : rends-toi à la gare la plus proche et paie le double du loyer au propriétaire.",
      "ch-nearest-utility":
        "Rends-toi au service public le plus proche. S'il a un propriétaire, lance les dés et paie-lui dix fois le résultat.",
      "ch-back-3": "Tu as pris la mauvaise sortie au rond-point : recule de 3 cases.",
      "ch-jail": "Tu as mis du ketchup sur tes pâtes : tu es démasqué ! Direction la garde à vue.",
      "ch-jail-card":
        "Une recommandation (raccomandazione) fait des merveilles : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "ch-dividend": `Dividende de ton entreprise d'huile d'olive : tu reçois ${m(50)}.`,
      "ch-loan": `Ton prêt bancaire est versé : tu reçois ${m(150)}.`,
      "ch-speeding": `Autovelox sur l'autostrada : amende de ${m(15)}.`,
      "ch-chairman": `Tu es élu président du club de football. Paie ${m(50)} à chaque joueur pour l'espresso.`,
      "ch-repairs": `Le condominio envoie la facture : ${m(25)} par maison, ${m(100)} par hôtel, ${m(200)} par gratte-ciel.`,
      "cc-go": `Rends-toi directement à la case Imbarco et reçois ${m(200)}. Andiamo !`,
      "cc-bank-error": `La banque te vire une somme par erreur : tu reçois ${m(200)}.`,
      "cc-doctor": `Note du médecin après trop de tiramisù : paie ${m(50)}.`,
      "cc-stock": `Tu vends des actions à la Bourse de Milan : tu reçois ${m(50)}.`,
      "cc-jail-card":
        "Un alibi en béton : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "cc-jail": "Conduite en Vespa sans casque : tu es démasqué ! Direction la garde à vue.",
      "cc-holiday": `Prime de Ferragosto : tu reçois ${m(100)}.`,
      "cc-tax-refund": `Remboursement d'impôts du fisc (un miracle) : tu reçois ${m(20)}.`,
      "cc-birthday": `C'est ton anniversaire : chaque joueur t'offre ${m(10)} et une part de torta.`,
      "cc-insurance": `Ton assurance-vie arrive à échéance : tu reçois ${m(100)}.`,
      "cc-hospital": `Frais d'hôpital : paie ${m(100)}.`,
      "cc-school": `Frais de scolarité de l'école privée : paie ${m(50)}.`,
      "cc-consultancy": `Honoraires de conseil pour une maison de mode milanaise : tu reçois ${m(25)}.`,
      "cc-street-repairs": `La commune rénove les pavés : paie ${m(40)} par maison, ${m(115)} par hôtel et ${m(250)} par gratte-ciel.`,
      "cc-beauty": `Tu remportes le deuxième prix du concours de gelato : tu reçois ${m(10)}.`,
      "cc-inherit": `La nonna de Toscane te lègue ${m(100)}.`,
    },
  };
})();

export const FR_THEME_TEXTS: Record<string, ThemeTexts> = { ch: CH, fr: FR, de: DE, it: IT };
