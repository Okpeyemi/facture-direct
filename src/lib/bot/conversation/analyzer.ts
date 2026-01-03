// src/lib/bot/conversation/analyzer.ts

import type {
  ConversationData,
  IntentAnalysis,
  ModuleExecution,
  ExtractedEntities,
} from './types';
import { getConversationHistoryForLLM } from './service';

/**
 * Liste des modules disponibles avec leurs descriptions
 */
const MODULES_DESCRIPTION = `
Modules disponibles :
1. search_client - Rechercher un client existant par nom ou entreprise
2. create_client - Créer un nouveau client
3. create_devis - Créer un devis (nécessite un client)
4. create_facture - Créer une facture (nécessite un client ou un devis)
5. list_devis - Lister les devis existants
6. list_factures - Lister les factures existantes
7. view_devis - Voir les détails d'un devis spécifique
8. view_facture - Voir les détails d'une facture spécifique
9. print_devis - Générer le PDF d'un devis
10. print_facture - Générer le PDF d'une facture
11. validate_facture - Valider une facture brouillon
12. settings - Voir/modifier les paramètres de l'entreprise
13. chat - Discussion générale (questions, aide, etc.)
`;

/**
 * Analyse le message utilisateur et détermine l'intention + les modules nécessaires
 */
export async function analyzeUserIntent(
  userMessage: string,
  conversationData: ConversationData,
  userContext?: { userName?: string; entrepriseName?: string; hasClients?: boolean }
): Promise<IntentAnalysis> {
  const history = getConversationHistoryForLLM(conversationData, 6);

  const systemPrompt = `Tu es un assistant intelligent pour FactureDirect, une application de facturation via WhatsApp.

TON RÔLE : Analyser le message de l'utilisateur et déterminer :
1. L'intention principale (ce que l'utilisateur veut accomplir)
2. Les entités mentionnées (client, entreprise, montant, description, etc.)
3. Les modules à utiliser et dans quel ordre
4. Si des informations manquent pour exécuter la demande

${MODULES_DESCRIPTION}

CONTEXTE UTILISATEUR :
${userContext?.userName ? `- Nom : ${userContext.userName}` : ''}
${userContext?.entrepriseName ? `- Entreprise : ${userContext.entrepriseName}` : ''}
${userContext?.hasClients ? '- A des clients existants' : '- Pas encore de clients'}

HISTORIQUE RÉCENT :
${history}

RÈGLES IMPORTANTES :
1. Pour créer une facture/devis, il faut d'abord identifier ou créer le client
2. Si l'utilisateur mentionne un nom de client/entreprise, utilise search_client d'abord
3. Si le client n'existe pas, propose create_client avant create_facture/create_devis
4. Extrais toutes les entités mentionnées (nom, entreprise, montant, description, quantité)
5. Sois naturel dans ta réponse, évite les menus et listes à puces

RÉPONDS UNIQUEMENT EN JSON VALIDE avec cette structure :
{
  "intent": "string (intention principale)",
  "confidence": number (0-1),
  "entities": {
    "clientName": "string ou null",
    "companyName": "string ou null",
    "amount": number ou null,
    "description": "string ou null",
    "quantity": number ou null,
    "devisNumber": "string ou null",
    "factureNumber": "string ou null"
  },
  "modules": [
    {"module": "nom_module", "params": {}, "order": 1}
  ],
  "naturalResponse": "string (réponse conversationnelle à donner à l'utilisateur)",
  "needsMoreInfo": boolean,
  "missingInfo": ["liste des infos manquantes"]
}`;

  const userPrompt = `Message de l'utilisateur : "${userMessage}"

Analyse ce message et retourne le JSON.`;

  console.log('[Analyzer] Début analyse pour:', userMessage);
  console.log('[Analyzer] GROQ_API_KEY présente:', !!process.env.GROQ_API_KEY);

  try {
    console.log('[Analyzer] Appel API Groq...');
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    console.log('[Analyzer] Réponse HTTP status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Analyzer] Erreur Groq:', errorText);
      return createFallbackAnalysis(userMessage);
    }

    const data = await response.json();
    console.log('[Analyzer] Réponse Groq reçue');
    const content = data.choices[0].message.content.trim();
    console.log('[Analyzer] Contenu LLM:', content.substring(0, 200));

    // Extraire le JSON de la réponse
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Analyzer] Pas de JSON trouvé dans la réponse:', content);
      return createFallbackAnalysis(userMessage);
    }

    const analysis = JSON.parse(jsonMatch[0]) as IntentAnalysis;

    // Enrichir les modules avec le statut
    analysis.modules = (analysis.modules || []).map((m, i) => ({
      ...m,
      order: m.order || i + 1,
      status: 'pending' as const,
      params: m.params || {},
    }));

    console.log('[Analyzer] Analyse complète:', JSON.stringify(analysis, null, 2));

    return analysis;
  } catch (error) {
    console.error('[Analyzer] Erreur technique:', error);
    return createFallbackAnalysis(userMessage);
  }
}

/**
 * Crée une analyse par défaut en cas d'erreur
 */
function createFallbackAnalysis(userMessage: string): IntentAnalysis {
  // Détection basique par mots-clés
  const lowerMessage = userMessage.toLowerCase();

  let intent = 'chat';
  let modules: ModuleExecution[] = [
    { module: 'chat', params: { message: userMessage }, order: 1, status: 'pending' },
  ];

  if (lowerMessage.includes('facture')) {
    intent = 'create_facture';
    modules = [{ module: 'create_facture', params: {}, order: 1, status: 'pending' }];
  } else if (lowerMessage.includes('devis')) {
    intent = 'create_devis';
    modules = [{ module: 'create_devis', params: {}, order: 1, status: 'pending' }];
  }

  return {
    intent,
    confidence: 0.5,
    entities: {},
    modules,
    naturalResponse: "Je n'ai pas bien compris. Pouvez-vous reformuler votre demande ?",
    needsMoreInfo: true,
    missingInfo: ['intention claire'],
  };
}

/**
 * Génère une réponse conversationnelle basée sur l'analyse
 */
export async function generateConversationalResponse(
  analysis: IntentAnalysis,
  conversationData: ConversationData
): Promise<string> {
  // Si l'analyse a déjà une réponse naturelle, l'utiliser
  if (analysis.naturalResponse && !analysis.needsMoreInfo) {
    return analysis.naturalResponse;
  }

  // Si des informations manquent, demander poliment
  if (analysis.needsMoreInfo && analysis.missingInfo?.length) {
    const missing = analysis.missingInfo.join(', ');
    return `J'ai compris que vous voulez ${analysis.intent.replace('_', ' ')}. ` +
      `J'aurais besoin de quelques informations : ${missing}. ` +
      `Pouvez-vous me les préciser ?`;
  }

  return analysis.naturalResponse || "Comment puis-je vous aider ?";
}
