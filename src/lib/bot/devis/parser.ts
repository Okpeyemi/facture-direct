// src/lib/bot/devis/parser.ts

/**
 * Parse les lignes de devis à partir d'un texte naturel.
 * Formats supportés :
 * - "10 heures consulting à 90€"
 * - "1 site web 2500€"
 * - "5 jours formation 600€/jour"
 * - "1 site web à 3000 €"
 * - "2 logos 500€ pièce"
 */
export function parseLignesSimple(text: string): any[] {
  const lignes: any[] = [];
  
  // Nettoyer le texte
  const cleanText = text.trim();
  
  // Pattern 1: "X description à/pour Y€" (avec séparateur explicite)
  const patternWithSeparator = /(\d+(?:[.,]\d+)?)\s*(h|heures?|j|jours?|unités?|x)?\s+(.+?)\s+(?:à|@|pour|:)\s*(\d+(?:[\s.,]\d+)?)\s*€/gi;
  
  // Pattern 2: "X description Y€" (prix directement après, sans séparateur)
  const patternDirect = /(\d+(?:[.,]\d+)?)\s*(h|heures?|j|jours?|unités?|x)?\s+(.+?)\s+(\d+(?:[\s.,]\d+)?)\s*€/gi;
  
  // Pattern 3: "description à Y€" (quantité = 1 implicite)
  const patternImplicit = /^(.+?)\s+(?:à|@|pour|:)?\s*(\d+(?:[\s.,]\d+)?)\s*€/i;

  let match;

  // Essayer pattern 1 d'abord (avec séparateur)
  while ((match = patternWithSeparator.exec(cleanText))) {
    const quantite = parseFloat(match[1].replace(',', '.'));
    const description = match[3].trim();
    const prixStr = match[4].replace(/\s/g, '').replace(',', '.');
    const prix = parseFloat(prixStr);

    if (!isNaN(quantite) && !isNaN(prix) && description && quantite > 0 && prix > 0) {
      lignes.push({ quantite, description, prixUnitaireHT: prix });
    }
  }

  // Si pattern 1 n'a rien trouvé, essayer pattern 2
  if (lignes.length === 0) {
    while ((match = patternDirect.exec(cleanText))) {
      const quantite = parseFloat(match[1].replace(',', '.'));
      const description = match[3].trim();
      const prixStr = match[4].replace(/\s/g, '').replace(',', '.');
      const prix = parseFloat(prixStr);

      if (!isNaN(quantite) && !isNaN(prix) && description && quantite > 0 && prix > 0) {
        lignes.push({ quantite, description, prixUnitaireHT: prix });
      }
    }
  }

  // Si toujours rien, essayer pattern 3 (quantité implicite = 1)
  if (lignes.length === 0) {
    match = patternImplicit.exec(cleanText);
    if (match) {
      const description = match[1].trim();
      const prixStr = match[2].replace(/\s/g, '').replace(',', '.');
      const prix = parseFloat(prixStr);

      if (!isNaN(prix) && description && prix > 0) {
        lignes.push({ quantite: 1, description, prixUnitaireHT: prix });
      }
    }
  }

  console.log(`[Parser] Texte: "${cleanText}" -> Lignes:`, lignes);
  return lignes;
}