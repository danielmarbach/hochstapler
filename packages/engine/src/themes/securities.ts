// Fictitious companies of the securities mode, per country (docs/DESIGN.md #48). Six per theme,
// tongue-in-cheek on purpose; the volatility (percent per round) makes the joke companies wild.
// Names are German base names; `SECURITY_NAMES` adds en/gsw/fr/it only where a translation is natural.
import type { Lang } from "../i18n/lang.ts";
import type { SecurityDef } from "../theme-types.ts";

export const CH_SECURITIES: SecurityDef[] = [
  {
    id: "ch-pilatus",
    sector: "tourism",
    name: "Pilatus Bergbahnen AG",
    startPrice: 80,
    volatility: 6,
  },
  { id: "ch-schoggi", sector: "food", name: "Lozärner Schoggi AG", startPrice: 60, volatility: 4 },
  { id: "ch-sbb", sector: "rail", name: "SBB Pünktlichkeits-AG", startPrice: 40, volatility: 11 },
  {
    id: "ch-krypto",
    sector: "bank",
    name: "Zuger Krypto-Treuhand",
    startPrice: 100,
    volatility: 15,
  },
  {
    id: "ch-gotthard",
    sector: "energy",
    name: "Gotthard Energie AG",
    startPrice: 70,
    volatility: 5,
  },
  {
    id: "ch-bahnhofstrass",
    sector: "realestate",
    name: "Bahnhofstrass Immobilien AG",
    startPrice: 120,
    volatility: 4,
  },
];

export const FR_SECURITIES: SecurityDef[] = [
  {
    id: "fr-eiffel",
    sector: "tourism",
    name: "Tour-Eiffel Ascenseurs SA",
    startPrice: 90,
    volatility: 6,
  },
  {
    id: "fr-camembert",
    sector: "food",
    name: "Camembert & Fils SA",
    startPrice: 55,
    volatility: 4,
  },
  { id: "fr-sncf", sector: "rail", name: "SNCF Retards & Cie", startPrice: 35, volatility: 11 },
  { id: "fr-credit", sector: "bank", name: "Crédit Croissant SA", startPrice: 110, volatility: 7 },
  { id: "fr-cafe", sector: "tech", name: "Crypto-Café Montmartre", startPrice: 95, volatility: 15 },
  {
    id: "fr-haussmann",
    sector: "realestate",
    name: "Immobilière Haussmann SA",
    startPrice: 130,
    volatility: 4,
  },
];

export const DE_SECURITIES: SecurityDef[] = [
  {
    id: "de-wiesn",
    sector: "tourism",
    name: "Oktoberfest Maßkrug AG",
    startPrice: 85,
    volatility: 7,
  },
  {
    id: "de-wurst",
    sector: "food",
    name: "Currywurst Hauptstadt AG",
    startPrice: 50,
    volatility: 4,
  },
  {
    id: "de-bahn",
    sector: "rail",
    name: "Deutsche Verspätungsbahn AG",
    startPrice: 38,
    volatility: 11,
  },
  {
    id: "de-wind",
    sector: "energy",
    name: "Windrad & Bratwurst Energie AG",
    startPrice: 70,
    volatility: 6,
  },
  { id: "de-fax", sector: "tech", name: "Faxgerät Digital GmbH", startPrice: 90, volatility: 14 },
  {
    id: "de-beton",
    sector: "realestate",
    name: "Betonburg Immobilien AG",
    startPrice: 125,
    volatility: 4,
  },
];

export const IT_SECURITIES: SecurityDef[] = [
  {
    id: "it-gondola",
    sector: "tourism",
    name: "Gondola Venezia Spa",
    startPrice: 85,
    volatility: 7,
  },
  { id: "it-pasta", sector: "food", name: "Pasta della Nonna Spa", startPrice: 55, volatility: 4 },
  { id: "it-treni", sector: "rail", name: "Treni in Ritardo Spa", startPrice: 36, volatility: 11 },
  { id: "it-banca", sector: "bank", name: "Banca del Cappuccino", startPrice: 105, volatility: 8 },
  { id: "it-crypto", sector: "tech", name: "Crypto-Pizza Spa", startPrice: 90, volatility: 15 },
  { id: "it-sole", sector: "energy", name: "Sole Mio Energia Spa", startPrice: 65, volatility: 6 },
];

/** Translated company names by language and security id; missing = the German name is used. */
export const SECURITY_NAMES: Partial<Record<Lang, Record<string, string>>> = {
  en: {
    "ch-sbb": "SBB Punctuality Ltd",
    "ch-krypto": "Zug Crypto Fiduciary",
    "fr-eiffel": "Eiffel Tower Lifts Ltd",
    "fr-sncf": "SNCF Delays & Co",
    "fr-credit": "Croissant Credit Ltd",
    "de-bahn": "German Delay Railways Inc.",
    "de-fax": "Fax Machine Digital Ltd",
    "it-treni": "Delayed Trains Ltd",
    "it-banca": "Cappuccino Bank",
  },
  gsw: {
    "ch-pilatus": "Pilatus Bergbahne AG",
    "ch-schoggi": "Lozärner Schoggi AG",
    "ch-sbb": "SBB Pünktlichkeits-AG",
    "ch-krypto": "Zuger Krypto-Treuhand",
    "ch-gotthard": "Gotthard Energie AG",
    "ch-bahnhofstrass": "Bahnhofstrass Immobilie AG",
  },
  fr: {
    "ch-pilatus": "Pilatus Remontées SA",
    "ch-schoggi": "Chocolat de Lucerne SA",
    "ch-sbb": "CFF Ponctualité SA",
    "ch-krypto": "Fiduciaire Crypto de Zoug",
    "ch-gotthard": "Gothard Énergie SA",
    "ch-bahnhofstrass": "Bahnhofstrasse Immobilier SA",
    "de-wiesn": "Chopes de l'Oktoberfest SA",
    "de-wurst": "Currywurst Capitale SA",
    "de-bahn": "Chemins de fer allemands du retard SA",
    "de-wind": "Éoliennes & Bratwurst Énergie SA",
    "de-fax": "Télécopieur Numérique Sàrl",
    "de-beton": "Béton-Forteresse Immobilier SA",
    "it-gondola": "Gondoles de Venise SA",
    "it-pasta": "Pâtes de la Nonna SA",
    "it-treni": "Trains en retard SA",
    "it-banca": "Banque du Cappuccino SA",
    "it-crypto": "Crypto-Pizza SA",
    "it-sole": "Énergie Sole Mio SA",
  },
  it: {
    "ch-pilatus": "Funivie del Pilatus SA",
    "ch-schoggi": "Cioccolato di Lucerna SA",
    "ch-sbb": "FFS Puntualità SA",
    "ch-krypto": "Fiduciaria Crypto di Zugo",
    "ch-gotthard": "Gottardo Energia SA",
    "ch-bahnhofstrass": "Bahnhofstrasse Immobiliare SA",
    "fr-eiffel": "Ascensori Tour Eiffel SA",
    "fr-camembert": "Camembert & Figli SA",
    "fr-sncf": "Ritardi SNCF & C.",
    "fr-credit": "Credito Croissant SA",
    "fr-haussmann": "Immobiliare Haussmann SA",
    "de-wiesn": "Boccali dell'Oktoberfest SA",
    "de-wurst": "Currywurst Capitale SA",
    "de-bahn": "Ferrovie tedesche in ritardo SA",
    "de-wind": "Pale eoliche & Bratwurst Energia SA",
    "de-fax": "Fax Digitale Srl",
    "de-beton": "Fortezza di Cemento Immobiliare SA",
  },
};
