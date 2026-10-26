// Italian theme texts (docs/DESIGN.md #76). Space names stay local (decision #31); card texts, group, deck and
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
    name: "Svizzera",
    groupNames: [
      "Grigioni",
      "Lucerna",
      "Basilea",
      "Berna",
      "Ticino",
      "Vaud",
      "Ginevra",
      "Zugo",
      "Engadina",
      "Zurigo",
    ],
    deckNames: { chance: "Cartolina", community: "Cantone" },
    tokenNames: {
      cow: "Mucca",
      "swiss-knife": "Coltellino svizzero",
      cheese: "Formaggio",
      watch: "Orologio",
      chocolate: "Cioccolato",
      "st-bernard": "San Bernardo",
      fondue: "Pentola per fonduta",
      gondola: "Cabinovia",
    },
    cardTexts: {
      "ch-go": `Il treno è eccezionalmente puntuale: vola direttamente alla casella Abflug e ritira ${m(200)}.`,
      "ch-g9-last": `Travestito da banchiere privato, gessato in prestito: prosegui il viaggio fino a ${t[51]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-g6-first": `Finto diplomatico a un ricevimento sul lago: prosegui il viaggio fino a ${t[33]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-g3-first": `Pass del Palazzo federale fatto in casa: prosegui il viaggio fino a ${t[14]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-station-1": `Finto capotreno: prosegui il viaggio fino a ${t[5]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-nearest-station":
        "Raggiungi la stazione più vicina. Se ha un proprietario, paga a lui il doppio dell'affitto (la coincidenza era ovviamente di nuovo in ritardo).",
      "ch-nearest-station-2":
        "Le FFS annunciano un ritardo al binario 3: raggiungi la stazione più vicina e paga al proprietario il doppio dell'affitto.",
      "ch-nearest-utility":
        "Finto letturista: raggiungi la società di servizi più vicina. Se ha un proprietario, tira i dadi e paga a lui dieci volte il risultato.",
      "ch-back-3": "Navigazione alla Röstigraben: torna indietro di 3 caselle.",
      "ch-jail":
        "Il Palace di Gstaad scopre che non sei un maragià: sei smascherato! Dritto in questura.",
      "ch-jail-card":
        "Alibi: un selfie davanti al fotomurale del Cervino. Conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "ch-dividend": `Dividendo della tua Scala Mobile del Cervino SA: ${m(50)}.`,
      "ch-loan": `Vendi il panorama del Pilatus per la seconda volta: ricevi ${m(150)}.`,
      "ch-speeding": `Autovelox al Gottardo, targa diplomatica di cartone: multa di ${m(15)}.`,
      "ch-chairman": `Finto erede di orologiai di Bienne, offri l'aperitivo: paga ${m(50)} a ogni giocatore.`,
      "ch-repairs": `I tuoi chalet di cartapesta vanno ridipinti: ${m(25)} per casa, ${m(100)} per albergo, ${m(200)} per grattacielo.`,
      "cc-go": `Assemblea comunale conclusa: vola direttamente alla casella Abflug e ritira ${m(200)}.`,
      "cc-bank-error": `La banca ti accredita troppo per errore (raro in Svizzera!): ricevi ${m(200)}.`,
      "cc-doctor": `Fattura del medico, la franchigia ti saluta: paga ${m(50)}.`,
      "cc-stock": `Vendi quote di una miniera d'oro nel Säntis: ricevi ${m(50)}.`,
      "cc-jail-card":
        "Tutta la cordata giura che eri in montagna: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "cc-jail":
        "Prova non autorizzata del corno delle Alpi in un quartiere residenziale: sei smascherato! Dritto in questura.",
      "cc-holiday": `Un grotto ticinese ti scambia per un critico gastronomico: ricevi ${m(100)}.`,
      "cc-tax-refund": `Il fisco crede al tuo domicilio a Zugo: ricevi ${m(20)}.`,
      "cc-birthday": `È (di nuovo) il tuo compleanno: ogni giocatore ti regala ${m(10)} e un cioccolatino.`,
      "cc-insurance": `L'assicurazione rimborsa il tuo orologio «antico» del mercatino: ricevi ${m(100)}.`,
      "cc-hospital": `Spese ospedaliere, i premi della cassa malati salgono ancora: paga ${m(100)}.`,
      "cc-school": `Corso vero per il tuo finto brevetto da maestro di sci a Zermatt: paga ${m(50)}.`,
      "cc-consultancy": `Una ditta di Zugo ti paga come «esperto di cripto»: ricevi ${m(25)}.`,
      "cc-street-repairs": `Il cantone ristruttura le strade: paga ${m(40)} per casa, ${m(115)} per albergo e ${m(250)} per grattacielo.`,
      "cc-beauty": `Vinci il secondo posto al concorso di bellezza del formaggio: ricevi ${m(10)}.`,
      "cc-inherit": `La tua nuovissima prozia dell'Emmental ti lascia ${m(100)}.`,
    },
  };
})();

const FR: ThemeTexts = (() => {
  const t = tiles(fr);
  const m = eur;
  return {
    name: "Francia",
    groupNames: [
      "Lille",
      "Strasburgo",
      "Bordeaux",
      "Lione",
      "Marsiglia",
      "Costa Azzurra",
      "Rive Gauche",
      "Montmartre",
      "Parigi di lusso",
      "Triangolo d'Oro",
    ],
    deckNames: { chance: "Cartolina", community: "Municipio" },
    tokenNames: {
      baguette: "Baguette",
      beret: "Basco",
      rooster: "Gallo gallico",
      croissant: "Croissant",
      "wine-bottle": "Bottiglia di vino",
      eiffel: "Torre Eiffel",
      scooter: "Scooter",
      perfume: "Flacone di profumo",
    },
    cardTexts: {
      "ch-go": `Nonostante lo sciopero il treno parte: vola direttamente alla casella Embarquement e ritira ${m(200)}.`,
      "ch-g9-last": `Prosegui il viaggio fino a ${t[51]} e spacciati per l'erede di una maison di profumi. Se nel tragitto attraversi la casella Embarquement, ritira ${m(200)}.`,
      "ch-g6-first": `Pausa croissant sulla Rive Gauche: prosegui il viaggio fino a ${t[33]}. Se nel tragitto attraversi la casella Embarquement, ritira ${m(200)}.`,
      "ch-g3-first": `Prosegui il viaggio fino a ${t[14]} e ordina un menù da bouchon. Se nel tragitto attraversi la casella Embarquement, ritira ${m(200)}.`,
      "ch-station-1": `Biglietto dipinto a mano: prosegui il viaggio fino a ${t[5]}. Se nel tragitto attraversi la casella Embarquement, ritira ${m(200)}.`,
      "ch-nearest-station":
        "Raggiungi la stazione più vicina. Se ha un proprietario, paga a lui il doppio dell'affitto (TGV, prenotazione obbligatoria naturalmente).",
      "ch-nearest-station-2":
        "La SNCF annuncia uno sciopero, quindi prendi la stazione più vicina: raggiungila e paga al proprietario il doppio dell'affitto.",
      "ch-nearest-utility":
        "Finto letturista: raggiungi la società di servizi più vicina. Se ha un proprietario, tira i dadi e paga a lui dieci volte il risultato.",
      "ch-back-3": "Ti sei perso alla rotonda dell'Arc de Triomphe: torna indietro di 3 caselle.",
      "ch-jail":
        "Un doganiere ti riconosce da un manifesto di ricercato: sei smascherato! Dritto in questura.",
      "ch-jail-card":
        "Il commissario si beve la storia della prova da mimo: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "ch-dividend": `Dividendo della tua tenuta vinicola (una cassa): ricevi ${m(50)}.`,
      "ch-loan": `Rivendi la Torre Eiffel, stavolta solo metà: ricevi ${m(150)}.`,
      "ch-speeding": `Autovelox sul Périphérique: multa di ${m(15)}.`,
      "ch-chairman": `Al casinò di Nizza ti spacci per un conte: paga ${m(50)} a ogni giocatore per lo champagne.`,
      "ch-repairs": `Il tuo castello di cartone sulla Loira va ridipinto: ${m(25)} per casa, ${m(100)} per albergo, ${m(200)} per grattacielo.`,
      "cc-go": `Berretto da comandante del mercatino: vola direttamente alla casella Embarquement e ritira ${m(200)}.`,
      "cc-bank-error": `La banca ti scambia per un barone di Bordeaux: ricevi ${m(200)}.`,
      "cc-doctor": `Conto del medico dopo troppo foie gras: paga ${m(50)}.`,
      "cc-stock": `Vendi azioni di una miniera di tartufi nel Périgord: ricevi ${m(50)}.`,
      "cc-jail-card":
        "Tutto il bistrot giura che eri al bancone: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "cc-jail": "Hai venduto vino in brick come grand cru: sei smascherato! Dritto in questura.",
      "cc-holiday": `Congés payés: il tuo premio ferie è di ${m(100)}.`,
      "cc-tax-refund": `Il fisco scambia il tuo yacht per un peschereccio: ricevi ${m(20)}.`,
      "cc-birthday": `Secondo il tuo terzo passaporto è il tuo compleanno: ogni giocatore ti regala ${m(10)} e un pain au chocolat.`,
      "cc-insurance": `L'assicurazione rimborsa il tuo «originale» di Montmartre: ricevi ${m(100)}.`,
      "cc-hospital": `Finto stuntman, gesso vero: paga ${m(100)}.`,
      "cc-school": `Ripetizioni per la tua finta laurea alla Sorbona: paga ${m(50)}.`,
      "cc-consultancy": `Onorario da finto esperto di profumi (col raffreddore): ricevi ${m(25)}.`,
      "cc-street-repairs": `La città rifà il selciato: paga ${m(40)} per casa, ${m(115)} per albergo e ${m(250)} per grattacielo.`,
      "cc-beauty": `Vinci il secondo premio al concorso del formaggio (camembert): ricevi ${m(10)}.`,
      "cc-inherit": `Una zia provenzale mai vista ti lascia ${m(100)}.`,
    },
  };
})();

const DE: ThemeTexts = (() => {
  const t = tiles(de);
  const m = eur;
  return {
    name: "Germania",
    groupNames: [
      "Ruhr",
      "Lipsia",
      "Dresda",
      "Colonia",
      "Francoforte",
      "Amburgo",
      "Stoccarda",
      "Monaco di Baviera",
      "Berlino",
      "Berlino Centro",
    ],
    deckNames: { chance: "Cartolina", community: "Land" },
    tokenNames: {
      pretzel: "Brezel",
      "beer-stein": "Boccale di birra",
      "beetle-car": "Maggiolino",
      "cuckoo-clock": "Orologio a cucù",
      "garden-gnome": "Nano da giardino",
      bratwurst: "Bratwurst",
      pickelhaube: "Elmo chiodato",
      train: "Treno ICE",
    },
    cardTexts: {
      "ch-go": `Con un'uniforme da pilota presa in prestito: vola direttamente alla casella Abflug e ritira ${m(200)}.`,
      "ch-g9-last": `Invitato a un ricevimento come conte di Chissàdove: prosegui il viaggio fino a ${t[51]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-g6-first": `Le Maultaschen sveve ti chiamano: prosegui il viaggio fino a ${t[33]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-g3-first": `Pausa Kölsch in Renania: prosegui il viaggio fino a ${t[14]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-station-1": `Finto controllore: prosegui il viaggio fino a ${t[5]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-nearest-station":
        "Raggiungi la stazione più vicina. Se ha un proprietario, paga a lui il doppio dell'affitto (treno soppresso, il bus sostitutivo costa extra).",
      "ch-nearest-station-2":
        "La tua Deutsche Bahn è in ritardo per un cambio nella composizione delle carrozze: raggiungi la stazione più vicina e paga al proprietario il doppio dell'affitto.",
      "ch-nearest-utility":
        "Finto letturista: raggiungi la società di servizi più vicina. Se ha un proprietario, tira i dadi e paga a lui dieci volte il risultato.",
      "ch-back-3": "Cantiere sulla A3, deviazione: torna indietro di 3 caselle.",
      "ch-jail":
        "Hai tagliato il prato durante il riposo di mezzogiorno: sei smascherato! Dritto in questura.",
      "ch-jail-card":
        "La polizia si beve la storia del gemello cattivo: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "ch-dividend": `Dividendo della tua Srl «Caccia alla Camera d'ambra»: ricevi ${m(50)}.`,
      "ch-loan": `Rivendi il castello di Neuschwanstein, un'altra volta: ricevi ${m(150)}.`,
      "ch-speeding": `Autovelox con la barba finta, foto nitida lo stesso: multa di ${m(15)}.`,
      "ch-chairman": `Da finto milionario della lotteria offri un giro: paga ${m(50)} a ogni giocatore per la birra.`,
      "ch-repairs": `L'amministratore manda il conteggio delle spese accessorie: ${m(25)} per casa, ${m(100)} per albergo, ${m(200)} per grattacielo.`,
      "cc-go": `Upgrade grazie a un falso titolo nobiliare: vola direttamente alla casella Abflug e ritira ${m(200)}.`,
      "cc-bank-error": `La banca ti scambia per un conte omonimo: ricevi ${m(200)}.`,
      "cc-doctor": `Conto del medico dopo l'Oktoberfest: paga ${m(50)}.`,
      "cc-stock": `Vendi azioni della tua società fantasma a Francoforte: ricevi ${m(50)}.`,
      "cc-jail-card":
        "Tutto il circolo di birilli giura che c'eri: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "cc-jail": "Rifiuti separati male nel bidone giallo: sei smascherato! Dritto in questura.",
      "cc-holiday": `Finta guida nella Speicherstadt: ricevi ${m(100)}.`,
      "cc-tax-refund": `Il fisco accetta il tuo studio in un castello: ricevi ${m(20)}.`,
      "cc-birthday": `Terzo compleanno quest'anno: ogni giocatore ti regala ${m(10)} e una fetta di torta.`,
      "cc-insurance": `L'assicurazione rimborsa il tuo orologio a cucù «antico»: ricevi ${m(100)}.`,
      "cc-hospital": `Finto primario, effetti collaterali veri: paga ${m(100)}.`,
      "cc-school": `Tassa per la tua laurea stampata in copisteria: paga ${m(50)}.`,
      "cc-consultancy": `Onorario da finto guru dell'IA per una start-up berlinese: ricevi ${m(25)}.`,
      "cc-street-repairs": `La città ristruttura le strade: paga ${m(40)} per casa, ${m(115)} per albergo e ${m(250)} per grattacielo.`,
      "cc-beauty": `Vinci il secondo premio al concorso di insalata di patate: ricevi ${m(10)}.`,
      "cc-inherit": `Tua zia bavarese (a sentire te) ti lascia ${m(100)}.`,
    },
  };
})();

const IT: ThemeTexts = (() => {
  const t = tiles(it);
  const m = eur;
  return {
    name: "Italia",
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
    deckNames: { chance: "Cartolina", community: "Comune" },
    tokenNames: {
      vespa: "Vespa",
      pizza: "Pizza",
      espresso: "Espresso",
      "gondola-venice": "Gondola",
      colosseum: "Colosseo",
      pasta: "Pasta",
      gelato: "Gelato",
      "tower-pisa": "Torre pendente",
    },
    cardTexts: {
      "ch-go": `Con un costume da pilota del Carnevale di Venezia: vola direttamente alla casella Imbarco e ritira ${m(200)}.`,
      "ch-g9-last": `Un gioielliere ti scambia per un principe: prosegui il viaggio fino a ${t[51]}. Se nel tragitto attraversi la casella Imbarco, ritira ${m(200)}.`,
      "ch-g6-first": `Fame di pesto: prosegui il viaggio fino a ${t[33]}. Se nel tragitto attraversi la casella Imbarco, ritira ${m(200)}.`,
      "ch-g3-first": `Pausa gianduiotto in Piemonte: prosegui il viaggio fino a ${t[14]}. Se nel tragitto attraversi la casella Imbarco, ritira ${m(200)}.`,
      "ch-station-1": `Biglietto omaggio falso: prosegui il viaggio fino a ${t[5]}. Se nel tragitto attraversi la casella Imbarco, ritira ${m(200)}.`,
      "ch-nearest-station":
        "Raggiungi la stazione più vicina. Se ha un proprietario, paga a lui il doppio dell'affitto (sciopero permettendo).",
      "ch-nearest-station-2":
        "Trenitalia è di nuovo in ritardo: raggiungi la stazione più vicina e paga al proprietario il doppio dell'affitto.",
      "ch-nearest-utility":
        "Finto letturista: raggiungi la società più vicina. Se ha un proprietario, tira i dadi e paga a lui dieci volte il risultato.",
      "ch-back-3": "Hai sbagliato uscita alla rotonda: torna indietro di 3 caselle.",
      "ch-jail": "La tua licenza da gondoliere è un souvenir: sei smascherato! Dritto in questura.",
      "ch-jail-card":
        "I carabinieri credono che sia un set di Cinecittà: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "ch-dividend": `Dividendo del tuo oleificio (un albero, una bottiglia): ricevi ${m(50)}.`,
      "ch-loan": `Vendi la Fontana di Trevi per la seconda volta: ricevi ${m(150)}.`,
      "ch-speeding": `Autovelox sull'autostrada: multa di ${m(15)}.`,
      "ch-chairman": `Al casinò di Sanremo fai il conte: paga ${m(50)} a ogni giocatore per l'espresso.`,
      "ch-repairs": `Il condominio manda il conto: ${m(25)} per casa, ${m(100)} per albergo, ${m(200)} per grattacielo.`,
      "cc-go": `Vola direttamente alla casella Imbarco e ritira ${m(200)}. Andiamo!`,
      "cc-bank-error": `La banca ti scambia per un conte fiorentino: ricevi ${m(200)}.`,
      "cc-doctor": `Conto del medico dopo troppo tiramisù: paga ${m(50)}.`,
      "cc-stock": `Vendi azioni della tua piantagione di spaghetti sul lago di Como: ricevi ${m(50)}.`,
      "cc-jail-card":
        "Tutte le nonne giurano che eri al pranzo della domenica: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "cc-jail":
        "Hai affittato il Colosseo come casa vacanze: sei smascherato! Dritto in questura.",
      "cc-holiday": `Capri ti scambia per un divo del cinema: ricevi ${m(100)}.`,
      "cc-tax-refund": `Rimborso fiscale dall'Agenzia delle Entrate (un miracolo): ricevi ${m(20)}.`,
      "cc-birthday": `Onomastico per ognuno dei tuoi nomi falsi: ogni giocatore ti regala ${m(10)} e una fetta di torta.`,
      "cc-insurance": `L'assicurazione rimborsa la tua anfora «antica» dell'edicola: ricevi ${m(100)}.`,
      "cc-hospital": `Finto tenore, mal di gola vero: paga ${m(100)}.`,
      "cc-school": `Corso di cucina per il finto chef stellato: paga ${m(50)}.`,
      "cc-consultancy": `Onorario da finto consulente di stile a Milano: ricevi ${m(25)}.`,
      "cc-street-repairs": `Il comune rifà il selciato: paga ${m(40)} per casa, ${m(115)} per albergo e ${m(250)} per grattacielo.`,
      "cc-beauty": `Vinci il secondo premio al concorso del gelato: ricevi ${m(10)}.`,
      "cc-inherit": `Una nonna toscana ti scambia per suo nipote: erediti ${m(100)}.`,
    },
  };
})();

export const IT_THEME_TEXTS: Record<string, ThemeTexts> = { ch: CH, fr: FR, de: DE, it: IT };
