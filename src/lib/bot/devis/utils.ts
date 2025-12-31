// src/lib/bot/devis/utils.ts

export interface ParsedDevisIntent {
  clientName?: string;
  resumeDevisId?: string;
  confidence: number;
}

export async function parseDevisIntent(text: string): Promise<ParsedDevisIntent> {
  const prompt = `
Analyse ce message WhatsApp en français pour extraire des détails sur un devis. Détermine :
- Client : Nom du client déduit du contexte (e.g., "espace vert" dans "devis pour espace vert"). Si absent ou ambigu, laisse vide.
- Reprise : ID du devis si mentionné (e.g., "devis 123"), sinon null.
Réponds en JSON strict : {"clientName": "...", "resumeDevisId": "...", "confidence": 0-1}.

Instructions :
- Sois flexible : Le client peut être n'importe où.
- Confiance : Basse si ambigu (e.g., <0.7).

Exemples :
- "créé moi un devis pour le espace vert" → {"clientName": "espace vert", "resumeDevisId": null, "confidence": 0.95}
- "reprends le devis 5 pour Dupont" → {"clientName": "Dupont", "resumeDevisId": "5", "confidence": 0.9}
- "un devis GSM" → {"clientName": "GSM", "resumeDevisId": null, "confidence": 0.85}
- "liste mes devis" → {"clientName": null, "resumeDevisId": null, "confidence": 0.1}

Message : "${text}"
`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL_MAIN || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`Erreur API Groq: ${response.status}`);
  }

  const data = await response.json();
  const result = JSON.parse(data.choices[0].message.content);
  return result;
}