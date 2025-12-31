import { STEPS } from './constants';
import type { ExtractedData } from './types';

// Fonction pour extraire les données avec LLM
export async function extractData(step: string, text: string): Promise<ExtractedData | null> {
  const prompts: Record<string, string> = {
    [STEPS.ASKING_NOM_ENTREPRISE]: `Extrait le nom de l'entreprise de ce message. Réponds seulement en JSON valide : {"nomEntreprise": "valeur"} ou {"nomEntreprise": null} si pas trouvé.`,
    [STEPS.ASKING_ADRESSE]: `Extrait l'adresse de l'entreprise de ce message. Réponds seulement en JSON valide : {"adresse": "valeur"} ou {"adresse": null} si pas trouvé.`,
    [STEPS.ASKING_SIREN]: `Extrait le numéro SIREN (9 chiffres) de ce message. Réponds seulement en JSON valide : {"siren": "valeur"} ou {"siren": null} si pas trouvé.`,
    [STEPS.ASKING_REGIME_TVA]: `Classifie le régime TVA de ce message parmi : ASSUJETTI_CLASSIQUE, FRANCHISE_BASE, OPTION_TVA, ASSOCIATION_NON_LUCRATIVE, ASSUJETTI_OUTRE_MER. Réponds seulement en JSON valide : {"regimeTVA": "CONSTANTE"} ou {"regimeTVA": null} si inconnu. Exemples : "TVA à 20%" → ASSUJETTI_CLASSIQUE, "franchise" → FRANCHISE_BASE, "option TVA" → OPTION_TVA.`,
  };

  const prompt = prompts[step];
  if (!prompt) return null;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL_MAIN || 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: `${prompt}\n\nMessage : "${text}"` }],
        max_tokens: 100,
        temperature: 0,
      }),
    });

    if (!response.ok) throw new Error(`Erreur API Groq: ${response.status}`);

    const data = await response.json();
    let content = data.choices[0].message.content.trim();

    // Nettoyer les blocs Markdown si présents
    if (content.startsWith('```json')) {
      content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (content.startsWith('```')) {
      content = content.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const result = JSON.parse(content);
    return result;
  } catch (error) {
    console.error('Erreur extraction LLM:', error);
    return null;
  }
}