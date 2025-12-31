import { STEPS } from './constants';
import type { ExtractedData } from './types';

// Fonction pour extraire les données avec LLM
export async function extractData(step: string, text: string): Promise<ExtractedData | null> {
  const prompts: Record<string, string> = {
    [STEPS.ASKING_NOM_ENTREPRISE]: `
      Tu es un assistant expert en création d'entreprise. L'utilisateur doit donner le nom de son entreprise.
      Analyse son message : "${text}"
      
      1. Si tu trouves un nom d'entreprise clair, extrais-le.
      2. Si l'utilisateur dit qu'il n'en a pas, ou veut tester, ou donne un nom invalide, propose-lui poliment un nom par défaut (ex: "Ma Société") ou demande une clarification.
      3. Si le message n'a aucun sens, demande-lui de répéter poliment.

      Réponds UNIQUEMENT en JSON :
      {
        "nomEntreprise": "Nom Trouvé" ou null,
        "reply": "Ta réponse à l'utilisateur ici (soit confirmation, soit demande de précision)"
      }
    `,
    [STEPS.ASKING_ADRESSE]: `
      Tu es un assistant. L'utilisateur doit donner l'adresse de son entreprise.
      Analyse son message : "${text}"

      1. Si tu trouves une adresse (même partielle), extrais-la.
      2. Si c'est incomplet ou vague, demande des précisions poliment.
      
      Réponds UNIQUEMENT en JSON :
      {
        "adresse": "Adresse Trouvée" ou null,
        "reply": "Ta réponse à l'utilisateur"
      }
    `,
    [STEPS.ASKING_SIREN]: `
      Tu es un assistant. L'utilisateur doit donner son SIREN (9 chiffres).
      Analyse son message : "${text}"

      1. Si tu trouves une suite de 9 chiffres, c'est le SIREN.
      2. Si l'utilisateur dit qu'il n'en a pas encore, explique-lui que c'est nécessaire ou propose d'utiliser un SIREN de test (000000000).
      
      Réponds UNIQUEMENT en JSON :
      {
        "siren": "123456789" ou null,
        "reply": "Ta réponse à l'utilisateur"
      }
    `,
    [STEPS.ASKING_REGIME_TVA]: `
      Tu es un assistant comptable. L'utilisateur doit choisir son régime TVA.
      Analyse son message : "${text}"
      
      Les choix possibles sont :
      - ASSUJETTI_CLASSIQUE (TVA classique)
      - FRANCHISE_BASE (Pas de TVA)
      - OPTION_TVA (Option sur débit)
      - ASSOCIATION_NON_LUCRATIVE
      - ASSUJETTI_OUTRE_MER

      Si l'utilisateur ne sait pas, explique-lui brièvement et suggère "Franchise en base" pour commencer.

      Réponds UNIQUEMENT en JSON :
      {
        "regimeTVA": "CONSTANTE_CHOISIE" ou null,
        "reply": "Ta réponse à l'utilisateur"
      }
    `,
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
        messages: [
          { role: 'system', content: 'Tu es un assistant serviable et empathique. Tu aides l\'utilisateur à configurer son compte. Réponds toujours en JSON valide.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.3, // Un peu de créativité pour les réponses
        response_format: { type: "json_object" } // Force le JSON
      }),
    });

    if (!response.ok) throw new Error(`Erreur API Groq: ${response.status}`);

    const data = await response.json();
    const content = data.choices[0].message.content.trim();

    console.log(`[Extractor] Réponse Groq pour ${step}:`, content);

    const result = JSON.parse(content);
    return result;
  } catch (error) {
    console.error('Erreur extraction LLM:', error);
    // Fallback en cas d'erreur technique
    return {
      reply: "Désolé, j'ai eu un petit souci technique. Pouvez-vous répéter votre réponse ?"
    };
  }
}