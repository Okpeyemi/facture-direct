// src/lib/bot/devis/parser.ts

export function parseLignesSimple(text: string): any[] {
  const lignes = [];
  const regex = /(\d+(?:[.,]\d+)?)\s*(h|heures?|j|jours?|unité|unités?)?\s*(.+?)\s*(?:à|@|pour)\s*(\d+(?:[.,]\d+)?)\s*€?\s*(ht)?/gi;

  let match;
  while ((match = regex.exec(text))) {
    const quantite = parseFloat(match[1].replace(',', '.'));
    const description = match[3].trim();
    const prix = parseFloat(match[4].replace(',', '.'));

    if (!isNaN(quantite) && !isNaN(prix) && description) {
      lignes.push({
        quantite,
        description,
        prixUnitaireHT: prix,
      });
    }
  }

  return lignes;
}