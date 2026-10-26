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
      "ch-g9-last": `Déguisé en banquier privé, costume rayé emprunté : poursuis ton voyage jusqu'à ${t[51]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-g6-first": `Faux diplomate invité à une réception au bord du lac : poursuis ton voyage jusqu'à ${t[33]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-g3-first": `Badge du Palais fédéral fait maison : poursuis ton voyage jusqu'à ${t[14]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-station-1": `Faux contrôleur : poursuis ton voyage jusqu'à ${t[5]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-nearest-station":
        "Rends-toi à la gare la plus proche. Si elle a un propriétaire, paie-lui le double du loyer (la correspondance était évidemment encore en retard).",
      "ch-nearest-station-2":
        "Les CFF annoncent un retard voie 3 : rends-toi à la gare la plus proche et paie le double du loyer au propriétaire.",
      "ch-nearest-utility":
        "Faux releveur de compteurs : rends-toi au service public le plus proche. S'il a un propriétaire, lance les dés et paie-lui dix fois le résultat.",
      "ch-back-3": "Navigation à la Röstigraben : recule de 3 cases.",
      "ch-jail":
        "Le palace de Gstaad découvre que tu n'es pas maharadjah : tu es démasqué ! Direction la garde à vue.",
      "ch-jail-card":
        "Alibi : un selfie devant un poster du Cervin. Garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "ch-dividend": `Dividende de ta société Escalators du Cervin SA : ${m(50)}.`,
      "ch-loan": `Tu vends la vue du Pilate pour la deuxième fois : tu reçois ${m(150)}.`,
      "ch-speeding": `Radar au Gothard, plaques diplomatiques en carton : amende de ${m(15)}.`,
      "ch-chairman": `Faux héritier horloger de Bienne, tu offres l'apéro : paie ${m(50)} à chaque joueur.`,
      "ch-repairs": `Tes chalets en carton-pâte ont besoin d'un coup de peinture : ${m(25)} par maison, ${m(100)} par hôtel, ${m(200)} par gratte-ciel.`,
      "cc-go": `Assemblée communale terminée : rends-toi directement à la case Abflug et reçois ${m(200)}.`,
      "cc-bank-error": `La banque te vire une somme par erreur (rare en Suisse !) : tu reçois ${m(200)}.`,
      "cc-doctor": `Facture du médecin, la franchise te dit bonjour : paie ${m(50)}.`,
      "cc-stock": `Tu vends des parts d'une mine d'or sous le Säntis : tu reçois ${m(50)}.`,
      "cc-jail-card":
        "Toute ta cordée jure que tu étais en montagne : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "cc-jail":
        "Répétition de cor des Alpes non autorisée dans un quartier résidentiel : tu es démasqué ! Direction la garde à vue.",
      "cc-holiday": `Un grotto tessinois te prend pour un critique gastronomique : tu reçois ${m(100)}.`,
      "cc-tax-refund": `Le fisc croit à ton domicile à Zoug : tu reçois ${m(20)}.`,
      "cc-birthday": `C'est (encore) ton anniversaire : chaque joueur t'offre ${m(10)} et un chocolat.`,
      "cc-insurance": `L'assurance rembourse ta montre « ancienne » des puces : tu reçois ${m(100)}.`,
      "cc-hospital": `Frais d'hôpital, les primes d'assurance-maladie augmentent encore : paie ${m(100)}.`,
      "cc-school": `Un vrai cours pour ton faux brevet de moniteur de ski à Zermatt : paie ${m(50)}.`,
      "cc-consultancy": `Une société zougoise te paie comme « expert crypto » : tu reçois ${m(25)}.`,
      "cc-street-repairs": `Le canton rénove les routes : paie ${m(40)} par maison, ${m(115)} par hôtel et ${m(250)} par gratte-ciel.`,
      "cc-beauty": `Tu remportes la deuxième place du concours de beauté du fromage : tu reçois ${m(10)}.`,
      "cc-inherit": `Ta toute nouvelle grand-tante de l'Emmental te lègue ${m(100)}.`,
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
      "ch-g9-last": `Poursuis ton voyage jusqu'à ${t[51]} et fais-toi passer pour l'héritier d'une maison de parfum. En repassant par la case Embarquement, tu touches ${m(200)}.`,
      "ch-g6-first": `Pause croissant sur la Rive Gauche : poursuis ton voyage jusqu'à ${t[33]}. En repassant par la case Embarquement, tu touches ${m(200)}.`,
      "ch-g3-first": `Poursuis ton voyage jusqu'à ${t[14]} et commande un menu de bouchon lyonnais. En repassant par la case Embarquement, tu touches ${m(200)}.`,
      "ch-station-1": `Billet peint à la main : poursuis ton voyage jusqu'à ${t[5]}. En repassant par la case Embarquement, tu touches ${m(200)}.`,
      "ch-nearest-station":
        "Rends-toi à la gare la plus proche. Si elle a un propriétaire, paie-lui le double du loyer (TGV, réservation obligatoire bien sûr).",
      "ch-nearest-station-2":
        "La SNCF annonce une grève, tu prends donc la gare la plus proche : rends-toi-y et paie le double du loyer au propriétaire.",
      "ch-nearest-utility":
        "Faux releveur de compteurs : rends-toi au service public le plus proche. S'il a un propriétaire, lance les dés et paie-lui dix fois le résultat.",
      "ch-back-3": "Tu t'es perdu au rond-point de l'Arc de Triomphe : recule de 3 cases.",
      "ch-jail":
        "Un douanier te reconnaît sur un avis de recherche : tu es démasqué ! Direction la garde à vue.",
      "ch-jail-card":
        "Le commissaire gobe ton histoire de répétition de mime : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "ch-dividend": `Dividende de ton domaine viticole (un carton) : tu reçois ${m(50)}.`,
      "ch-loan": `Tu revends la tour Eiffel, juste la moitié : tu reçois ${m(150)}.`,
      "ch-speeding": `Radar sur le périphérique : amende de ${m(15)}.`,
      "ch-chairman": `Au casino de Nice, tu te fais passer pour un comte : paie ${m(50)} à chaque joueur pour le champagne.`,
      "ch-repairs": `Ton château de la Loire en carton a besoin de peinture : ${m(25)} par maison, ${m(100)} par hôtel, ${m(200)} par gratte-ciel.`,
      "cc-go": `Casquette de commandant chinée aux puces : rends-toi directement à la case Embarquement et reçois ${m(200)}.`,
      "cc-bank-error": `La banque te prend pour un baron bordelais : tu reçois ${m(200)}.`,
      "cc-doctor": `Note du médecin après trop de foie gras : paie ${m(50)}.`,
      "cc-stock": `Tu vends des actions d'une mine de truffes dans le Périgord : tu reçois ${m(50)}.`,
      "cc-jail-card":
        "Tout le bistrot jure que tu étais au comptoir : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "cc-jail":
        "Tu as vendu du vin en brique comme grand cru : tu es démasqué ! Direction la garde à vue.",
      "cc-holiday": `Congés payés : ta prime de vacances est de ${m(100)}.`,
      "cc-tax-refund": `Le fisc prend ton yacht pour un bateau de pêche : tu reçois ${m(20)}.`,
      "cc-birthday": `Ton troisième passeport dit que c'est ton anniversaire : chaque joueur t'offre ${m(10)} et un pain au chocolat.`,
      "cc-insurance": `L'assurance rembourse ton « original » de Montmartre : tu reçois ${m(100)}.`,
      "cc-hospital": `Faux cascadeur, vrai plâtre : paie ${m(100)}.`,
      "cc-school": `Cours du soir pour ton faux diplôme de la Sorbonne : paie ${m(50)}.`,
      "cc-consultancy": `Honoraires de faux nez pour un parfumeur (tu es enrhumé) : tu reçois ${m(25)}.`,
      "cc-street-repairs": `La ville rénove les pavés : paie ${m(40)} par maison, ${m(115)} par hôtel et ${m(250)} par gratte-ciel.`,
      "cc-beauty": `Tu remportes le deuxième prix du concours de fromage (camembert) : tu reçois ${m(10)}.`,
      "cc-inherit": `Une tante de Provence parfaitement inconnue te lègue ${m(100)}.`,
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
      "ch-go": `Dans un uniforme de pilote emprunté : rends-toi directement à la case Abflug et reçois ${m(200)}.`,
      "ch-g9-last": `Invité à une réception en comte de Nulle-Part : poursuis ton voyage jusqu'à ${t[51]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-g6-first": `Les Maultaschen souabes t'appellent : poursuis ton voyage jusqu'à ${t[33]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-g3-first": `Pause Kölsch en Rhénanie : poursuis ton voyage jusqu'à ${t[14]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-station-1": `Faux contrôleur : poursuis ton voyage jusqu'à ${t[5]}. En repassant par la case Abflug, tu touches ${m(200)}.`,
      "ch-nearest-station":
        "Rends-toi à la gare la plus proche. Si elle a un propriétaire, paie-lui le double du loyer (train supprimé, le bus de remplacement coûte en plus).",
      "ch-nearest-station-2":
        "Ta Deutsche Bahn a du retard à cause d'un changement de composition des voitures : rends-toi à la gare la plus proche et paie le double du loyer au propriétaire.",
      "ch-nearest-utility":
        "Faux releveur de compteurs : rends-toi au service public le plus proche. S'il a un propriétaire, lance les dés et paie-lui dix fois le résultat.",
      "ch-back-3": "Chantier sur l'A3, déviation : recule de 3 cases.",
      "ch-jail":
        "Tu as tondu la pelouse pendant la pause de midi : tu es démasqué ! Direction la garde à vue.",
      "ch-jail-card":
        "La police gobe ton histoire de jumeau maléfique : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "ch-dividend": `Dividende de ta SARL « Chasse à la Chambre d'ambre » : tu reçois ${m(50)}.`,
      "ch-loan": `Tu revends le château de Neuschwanstein, encore une fois : tu reçois ${m(150)}.`,
      "ch-speeding": `Flashé avec une fausse barbe, photo nette quand même : amende de ${m(15)}.`,
      "ch-chairman": `En faux millionnaire du loto, tu offres une tournée : paie ${m(50)} à chaque joueur pour la bière.`,
      "ch-repairs": `La gérance envoie le décompte des charges : ${m(25)} par maison, ${m(100)} par hôtel, ${m(200)} par gratte-ciel.`,
      "cc-go": `Surclassé grâce à un faux titre de noblesse : rends-toi directement à la case Abflug et reçois ${m(200)}.`,
      "cc-bank-error": `La banque te confond avec un comte du même nom : tu reçois ${m(200)}.`,
      "cc-doctor": `Note du médecin après l'Oktoberfest : paie ${m(50)}.`,
      "cc-stock": `Tu vends des actions de ta société boîte aux lettres à Francfort : tu reçois ${m(50)}.`,
      "cc-jail-card":
        "Tout le club de quilles jure que tu y étais : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "cc-jail":
        "Déchets mal triés dans la poubelle jaune : tu es démasqué ! Direction la garde à vue.",
      "cc-holiday": `Faux guide dans la Speicherstadt : tu reçois ${m(100)}.`,
      "cc-tax-refund": `Le fisc accepte ton bureau à domicile dans un château : tu reçois ${m(20)}.`,
      "cc-birthday": `Ton troisième anniversaire de l'année : chaque joueur t'offre ${m(10)} et une part de gâteau.`,
      "cc-insurance": `L'assurance rembourse ton coucou « ancien » : tu reçois ${m(100)}.`,
      "cc-hospital": `Faux médecin-chef, vrais effets secondaires : paie ${m(100)}.`,
      "cc-school": `Frais pour ton doctorat sorti de la photocopieuse : paie ${m(50)}.`,
      "cc-consultancy": `Honoraires de faux gourou de l'IA pour une start-up berlinoise : tu reçois ${m(25)}.`,
      "cc-street-repairs": `La ville rénove les rues : paie ${m(40)} par maison, ${m(115)} par hôtel et ${m(250)} par gratte-ciel.`,
      "cc-beauty": `Tu remportes le deuxième prix du concours de salade de pommes de terre : tu reçois ${m(10)}.`,
      "cc-inherit": `Ta tante de Bavière (à t'en croire) te lègue ${m(100)}.`,
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
      "ch-go": `Dans un costume de pilote du carnaval de Venise : rends-toi directement à la case Imbarco et reçois ${m(200)}.`,
      "ch-g9-last": `Un joaillier te prend pour un principe : poursuis ton voyage jusqu'à ${t[51]}. En repassant par la case Imbarco, tu touches ${m(200)}.`,
      "ch-g6-first": `Envie de pesto : poursuis ton voyage jusqu'à ${t[33]}. En repassant par la case Imbarco, tu touches ${m(200)}.`,
      "ch-g3-first": `Pause gianduiotto au Piémont : poursuis ton voyage jusqu'à ${t[14]}. En repassant par la case Imbarco, tu touches ${m(200)}.`,
      "ch-station-1": `Faux billet gratuit : poursuis ton voyage jusqu'à ${t[5]}. En repassant par la case Imbarco, tu touches ${m(200)}.`,
      "ch-nearest-station":
        "Rends-toi à la gare la plus proche. Si elle a un propriétaire, paie-lui le double du loyer (sous réserve de sciopero).",
      "ch-nearest-station-2":
        "Trenitalia a encore du retard : rends-toi à la gare la plus proche et paie le double du loyer au propriétaire.",
      "ch-nearest-utility":
        "Faux releveur de compteurs : rends-toi au service public le plus proche. S'il a un propriétaire, lance les dés et paie-lui dix fois le résultat.",
      "ch-back-3": "Tu as pris la mauvaise sortie au rond-point : recule de 3 cases.",
      "ch-jail":
        "Ta licence de gondolier est un souvenir : tu es démasqué ! Direction la garde à vue.",
      "ch-jail-card":
        "Les carabiniers croient à un tournage pour Cinecittà : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "ch-dividend": `Dividende de ta société d'huile d'olive (un arbre, une bouteille) : tu reçois ${m(50)}.`,
      "ch-loan": `Tu revends la fontaine de Trevi : tu reçois ${m(150)}.`,
      "ch-speeding": `Autovelox sur l'autostrada : amende de ${m(15)}.`,
      "ch-chairman": `Au casino de Sanremo, tu joues au comte : paie ${m(50)} à chaque joueur pour l'espresso.`,
      "ch-repairs": `Le condominio envoie la facture : ${m(25)} par maison, ${m(100)} par hôtel, ${m(200)} par gratte-ciel.`,
      "cc-go": `Rends-toi directement à la case Imbarco et reçois ${m(200)}. Andiamo !`,
      "cc-bank-error": `La banque te prend pour un comte florentin : tu reçois ${m(200)}.`,
      "cc-doctor": `Note du médecin après trop de tiramisù : paie ${m(50)}.`,
      "cc-stock": `Tu vends des actions de ta plantation de spaghettis du lac de Côme : tu reçois ${m(50)}.`,
      "cc-jail-card":
        "Toutes les nonnas jurent que tu étais au déjeuner du dimanche : garde cette carte. Si tu te retrouves en garde à vue, joue-la pour être libéré aussitôt.",
      "cc-jail":
        "Tu as loué le Colisée en meublé de vacances : tu es démasqué ! Direction la garde à vue.",
      "cc-holiday": `Capri te prend pour une star de cinéma : tu reçois ${m(100)}.`,
      "cc-tax-refund": `Remboursement d'impôts du fisc (un miracle) : tu reçois ${m(20)}.`,
      "cc-birthday": `Une fête pour chacun de tes faux prénoms : chaque joueur t'offre ${m(10)} et une part de torta.`,
      "cc-insurance": `L'assurance rembourse ton amphore « antique » du kiosque : tu reçois ${m(100)}.`,
      "cc-hospital": `Faux ténor, vraie angine : paie ${m(100)}.`,
      "cc-school": `Cours de cuisine pour le faux chef étoilé : paie ${m(50)}.`,
      "cc-consultancy": `Honoraires de faux conseiller en style à Milan : tu reçois ${m(25)}.`,
      "cc-street-repairs": `La commune rénove les pavés : paie ${m(40)} par maison, ${m(115)} par hôtel et ${m(250)} par gratte-ciel.`,
      "cc-beauty": `Tu remportes le deuxième prix du concours de gelato : tu reçois ${m(10)}.`,
      "cc-inherit": `Une nonna toscane te prend pour son petit-fils : tu hérites de ${m(100)}.`,
    },
  };
})();

export const FR_THEME_TEXTS: Record<string, ThemeTexts> = { ch: CH, fr: FR, de: DE, it: IT };
