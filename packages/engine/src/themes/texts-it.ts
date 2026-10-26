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
      "ch-g9-last": `Il tuo consulente bancario ti invita: prosegui il viaggio fino a ${t[51]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-g6-first": `Voglia di fonduta sul lago: prosegui il viaggio fino a ${t[33]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-g3-first": `Gita politica: prosegui il viaggio fino a ${t[14]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-station-1": `Prosegui il viaggio fino a ${t[5]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-nearest-station":
        "Raggiungi la stazione più vicina. Se ha un proprietario, paga a lui il doppio dell'affitto (la coincidenza era ovviamente di nuovo in ritardo).",
      "ch-nearest-station-2":
        "Le FFS annunciano un ritardo al binario 3: raggiungi la stazione più vicina e paga al proprietario il doppio dell'affitto.",
      "ch-nearest-utility":
        "Raggiungi la società di servizi più vicina. Se ha un proprietario, tira i dadi e paga a lui dieci volte il risultato.",
      "ch-back-3": "Navigazione alla Röstigraben: torna indietro di 3 caselle.",
      "ch-jail": "Disturbo della quiete notturna dopo le 22: sei smascherato! Dritto in questura.",
      "ch-jail-card":
        "Le giuste conoscenze servono: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "ch-dividend": `La banca ti paga un dividendo: ${m(50)}.`,
      "ch-loan": `Il tuo contratto di risparmio edilizio scade: ricevi ${m(150)}.`,
      "ch-speeding": `Autovelox sulla tratta del Gottardo: multa di ${m(15)}.`,
      "ch-chairman": `Sei eletto presidente del consiglio di amministrazione. Paga ${m(50)} a ogni giocatore per l'aperitivo.`,
      "ch-repairs": `L'associazione dei proprietari di casa manda il conto: ${m(25)} per casa, ${m(100)} per albergo, ${m(200)} per grattacielo.`,
      "cc-go": `Assemblea comunale conclusa: vola direttamente alla casella Abflug e ritira ${m(200)}.`,
      "cc-bank-error": `La banca ti accredita troppo per errore (raro in Svizzera!): ricevi ${m(200)}.`,
      "cc-doctor": `Fattura del medico, la franchigia ti saluta: paga ${m(50)}.`,
      "cc-stock": `Vendi azioni alla SIX: ricevi ${m(50)}.`,
      "cc-jail-card":
        "Un alibi di ferro: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "cc-jail":
        "Prova non autorizzata del corno delle Alpi in un quartiere residenziale: sei smascherato! Dritto in questura.",
      "cc-holiday": `Il tuo fondo vacanze viene pagato: ricevi ${m(100)}.`,
      "cc-tax-refund": `Rimborso fiscale dal cantone: ricevi ${m(20)}.`,
      "cc-birthday": `È il tuo compleanno: ogni giocatore ti regala ${m(10)} e un cioccolatino.`,
      "cc-insurance": `La tua assicurazione sulla vita scade: ricevi ${m(100)}.`,
      "cc-hospital": `Spese ospedaliere, i premi della cassa malati salgono ancora: paga ${m(100)}.`,
      "cc-school": `Retta della scuola privata sullo Zürichberg: paga ${m(50)}.`,
      "cc-consultancy": `Onorario di consulenza per un mandato fiduciario: ricevi ${m(25)}.`,
      "cc-street-repairs": `Il cantone ristruttura le strade: paga ${m(40)} per casa, ${m(115)} per albergo e ${m(250)} per grattacielo.`,
      "cc-beauty": `Vinci il secondo posto al concorso di bellezza del formaggio: ricevi ${m(10)}.`,
      "cc-inherit": `La prozia dell'Emmental ti lascia ${m(100)}.`,
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
      "ch-g9-last": `Prosegui il viaggio fino a ${t[51]}, dove si vede e si è visti. Se nel tragitto attraversi la casella Embarquement, ritira ${m(200)}.`,
      "ch-g6-first": `Pausa croissant sulla Rive Gauche: prosegui il viaggio fino a ${t[33]}. Se nel tragitto attraversi la casella Embarquement, ritira ${m(200)}.`,
      "ch-g3-first": `Prosegui il viaggio fino a ${t[14]} e ordina un menù da bouchon. Se nel tragitto attraversi la casella Embarquement, ritira ${m(200)}.`,
      "ch-station-1": `Prosegui il viaggio fino a ${t[5]}. Se nel tragitto attraversi la casella Embarquement, ritira ${m(200)}.`,
      "ch-nearest-station":
        "Raggiungi la stazione più vicina. Se ha un proprietario, paga a lui il doppio dell'affitto (TGV, prenotazione obbligatoria naturalmente).",
      "ch-nearest-station-2":
        "La SNCF annuncia uno sciopero, quindi prendi la stazione più vicina: raggiungila e paga al proprietario il doppio dell'affitto.",
      "ch-nearest-utility":
        "Raggiungi la società di servizi più vicina. Se ha un proprietario, tira i dadi e paga a lui dieci volte il risultato.",
      "ch-back-3": "Ti sei perso alla rotonda dell'Arc de Triomphe: torna indietro di 3 caselle.",
      "ch-jail": "Hai barato a pétanque: sei smascherato! Dritto in questura.",
      "ch-jail-card":
        "Le buone conoscenze aprono porte: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "ch-dividend": `Dividendo dalla tua tenuta vinicola: ricevi ${m(50)}.`,
      "ch-loan": `Il tuo prestito bancario viene erogato: ricevi ${m(150)}.`,
      "ch-speeding": `Autovelox sul Périphérique: multa di ${m(15)}.`,
      "ch-chairman": `Sei eletto presidente del Club dei Boulevard. Paga ${m(50)} a ogni giocatore per lo champagne.`,
      "ch-repairs": `La mairie manda il conto per la facciata: ${m(25)} per casa, ${m(100)} per albergo, ${m(200)} per grattacielo.`,
      "cc-go": `Vola direttamente alla casella Embarquement e ritira ${m(200)}. Vive la France!`,
      "cc-bank-error": `La banca ti accredita troppo per errore: ricevi ${m(200)}.`,
      "cc-doctor": `Conto del medico dopo troppo foie gras: paga ${m(50)}.`,
      "cc-stock": `Vendi azioni alla Borsa di Parigi: ricevi ${m(50)}.`,
      "cc-jail-card":
        "Un alibi di ferro: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "cc-jail": "Non hai pagato la baguette: sei smascherato! Dritto in questura.",
      "cc-holiday": `Congés payés: il tuo premio ferie è di ${m(100)}.`,
      "cc-tax-refund": `Rimborso fiscale dall'erario: ricevi ${m(20)}.`,
      "cc-birthday": `È il tuo compleanno: ogni giocatore ti regala ${m(10)} e un pain au chocolat.`,
      "cc-insurance": `La tua assicurazione sulla vita scade: ricevi ${m(100)}.`,
      "cc-hospital": `Spese ospedaliere: paga ${m(100)}.`,
      "cc-school": `Retta della Grande École: paga ${m(50)}.`,
      "cc-consultancy": `Onorario di consulenza per una start-up parigina: ricevi ${m(25)}.`,
      "cc-street-repairs": `La città rifà il selciato: paga ${m(40)} per casa, ${m(115)} per albergo e ${m(250)} per grattacielo.`,
      "cc-beauty": `Vinci il secondo premio al concorso del formaggio (camembert): ricevi ${m(10)}.`,
      "cc-inherit": `Una zia della Provenza ti lascia ${m(100)}.`,
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
      "ch-go": `Il treno è eccezionalmente puntuale: vola direttamente alla casella Abflug e ritira ${m(200)}.`,
      "ch-g9-last": `Appuntamento alla Cancelleria: prosegui il viaggio fino a ${t[51]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-g6-first": `Le Maultaschen sveve ti chiamano: prosegui il viaggio fino a ${t[33]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-g3-first": `Pausa Kölsch in Renania: prosegui il viaggio fino a ${t[14]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-station-1": `Prosegui il viaggio fino a ${t[5]}. Se nel tragitto attraversi la casella Abflug, ritira ${m(200)}.`,
      "ch-nearest-station":
        "Raggiungi la stazione più vicina. Se ha un proprietario, paga a lui il doppio dell'affitto (treno soppresso, il bus sostitutivo costa extra).",
      "ch-nearest-station-2":
        "La tua Deutsche Bahn è in ritardo per un cambio nella composizione delle carrozze: raggiungi la stazione più vicina e paga al proprietario il doppio dell'affitto.",
      "ch-nearest-utility":
        "Raggiungi la società di servizi più vicina. Se ha un proprietario, tira i dadi e paga a lui dieci volte il risultato.",
      "ch-back-3": "Cantiere sulla A3, deviazione: torna indietro di 3 caselle.",
      "ch-jail":
        "Hai tagliato il prato durante il riposo di mezzogiorno: sei smascherato! Dritto in questura.",
      "ch-jail-card":
        "Il tuo ricorso all'ufficio d'ordine pubblico va a buon fine: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "ch-dividend": `Dividendo dal DAX: ricevi ${m(50)}.`,
      "ch-loan": `Il tuo contratto di risparmio edilizio viene assegnato: ricevi ${m(150)}.`,
      "ch-speeding": `Autovelox nella zona 30: multa di ${m(15)}.`,
      "ch-chairman": `Sei eletto presidente dell'associazione. Paga ${m(50)} a ogni giocatore per la birra.`,
      "ch-repairs": `L'amministratore manda il conteggio delle spese accessorie: ${m(25)} per casa, ${m(100)} per albergo, ${m(200)} per grattacielo.`,
      "cc-go": `Vola direttamente alla casella Abflug e ritira ${m(200)}.`,
      "cc-bank-error": `La banca ti accredita troppo per errore: ricevi ${m(200)}.`,
      "cc-doctor": `Conto del medico dopo l'Oktoberfest: paga ${m(50)}.`,
      "cc-stock": `Vendi azioni alla Borsa di Francoforte: ricevi ${m(50)}.`,
      "cc-jail-card":
        "Un alibi di ferro: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "cc-jail": "Rifiuti separati male nel bidone giallo: sei smascherato! Dritto in questura.",
      "cc-holiday": `Il tuo premio ferie viene pagato: ricevi ${m(100)}.`,
      "cc-tax-refund": `Rimborso fiscale dall'erario: ricevi ${m(20)}.`,
      "cc-birthday": `È il tuo compleanno: ogni giocatore ti regala ${m(10)} e una fetta di torta.`,
      "cc-insurance": `La tua assicurazione sulla vita scade: ricevi ${m(100)}.`,
      "cc-hospital": `Ticket ospedaliero: paga ${m(100)}.`,
      "cc-school": `Retta della scuola privata: paga ${m(50)}.`,
      "cc-consultancy": `Onorario di consulenza per una start-up berlinese: ricevi ${m(25)}.`,
      "cc-street-repairs": `La città ristruttura le strade: paga ${m(40)} per casa, ${m(115)} per albergo e ${m(250)} per grattacielo.`,
      "cc-beauty": `Vinci il secondo premio al concorso di insalata di patate: ricevi ${m(10)}.`,
      "cc-inherit": `La zia della Baviera ti lascia ${m(100)}.`,
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
      "ch-go": `Il treno è eccezionalmente puntuale: vola direttamente alla casella Imbarco e ritira ${m(200)}.`,
      "ch-g9-last": `Aperitivo nel cuore di Roma: prosegui il viaggio fino a ${t[51]}. Se nel tragitto attraversi la casella Imbarco, ritira ${m(200)}.`,
      "ch-g6-first": `Fame di pesto: prosegui il viaggio fino a ${t[33]}. Se nel tragitto attraversi la casella Imbarco, ritira ${m(200)}.`,
      "ch-g3-first": `Pausa gianduiotto in Piemonte: prosegui il viaggio fino a ${t[14]}. Se nel tragitto attraversi la casella Imbarco, ritira ${m(200)}.`,
      "ch-station-1": `Prosegui il viaggio fino a ${t[5]}. Se nel tragitto attraversi la casella Imbarco, ritira ${m(200)}.`,
      "ch-nearest-station":
        "Raggiungi la stazione più vicina. Se ha un proprietario, paga a lui il doppio dell'affitto (sciopero permettendo).",
      "ch-nearest-station-2":
        "Trenitalia è di nuovo in ritardo: raggiungi la stazione più vicina e paga al proprietario il doppio dell'affitto.",
      "ch-nearest-utility":
        "Raggiungi la società più vicina. Se ha un proprietario, tira i dadi e paga a lui dieci volte il risultato.",
      "ch-back-3": "Hai sbagliato uscita alla rotonda: torna indietro di 3 caselle.",
      "ch-jail": "Hai messo il ketchup sulla pasta: sei smascherato! Dritto in questura.",
      "ch-jail-card":
        "Una buona raccomandazione fa miracoli: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "ch-dividend": `Dividendo dalla tua azienda di olio d'oliva: ricevi ${m(50)}.`,
      "ch-loan": `Il tuo prestito bancario viene erogato: ricevi ${m(150)}.`,
      "ch-speeding": `Autovelox sull'autostrada: multa di ${m(15)}.`,
      "ch-chairman": `Sei eletto presidente della squadra di calcio. Paga ${m(50)} a ogni giocatore per l'espresso.`,
      "ch-repairs": `Il condominio manda il conto: ${m(25)} per casa, ${m(100)} per albergo, ${m(200)} per grattacielo.`,
      "cc-go": `Vola direttamente alla casella Imbarco e ritira ${m(200)}. Andiamo!`,
      "cc-bank-error": `La banca ti accredita troppo per errore: ricevi ${m(200)}.`,
      "cc-doctor": `Conto del medico dopo troppo tiramisù: paga ${m(50)}.`,
      "cc-stock": `Vendi azioni alla Borsa di Milano: ricevi ${m(50)}.`,
      "cc-jail-card":
        "Un alibi di ferro: conserva questa carta. Se finisci in questura, giocala e torni libero subito.",
      "cc-jail": "Giri in Vespa senza casco: sei smascherato! Dritto in questura.",
      "cc-holiday": `Bonus di Ferragosto: ricevi ${m(100)}.`,
      "cc-tax-refund": `Rimborso fiscale dall'Agenzia delle Entrate (un miracolo): ricevi ${m(20)}.`,
      "cc-birthday": `È il tuo compleanno: ogni giocatore ti regala ${m(10)} e una fetta di torta.`,
      "cc-insurance": `La tua assicurazione sulla vita scade: ricevi ${m(100)}.`,
      "cc-hospital": `Spese ospedaliere: paga ${m(100)}.`,
      "cc-school": `Retta della scuola privata: paga ${m(50)}.`,
      "cc-consultancy": `Onorario di consulenza per una casa di moda milanese: ricevi ${m(25)}.`,
      "cc-street-repairs": `Il comune rifà il selciato: paga ${m(40)} per casa, ${m(115)} per albergo e ${m(250)} per grattacielo.`,
      "cc-beauty": `Vinci il secondo premio al concorso del gelato: ricevi ${m(10)}.`,
      "cc-inherit": `La nonna toscana ti lascia ${m(100)}.`,
    },
  };
})();

export const IT_THEME_TEXTS: Record<string, ThemeTexts> = { ch: CH, fr: FR, de: DE, it: IT };
