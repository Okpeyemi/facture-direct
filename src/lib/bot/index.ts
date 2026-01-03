// src/lib/bot/index.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';
import { normalizePhone } from './utils/phone';
import * as tools from './tools';

interface MessageContext {
  from: string;
  text: string;
  isVoice: boolean;
}

interface ConversationContext {
  intent?: string;
  entities: {
    clientName?: string;
    companyName?: string;
    amount?: number;
    description?: string;
    quantity?: number;
    settingName?: string;   // Pour les modifications de paramètres
    settingValue?: string;  // Nouvelle valeur du paramètre
  };
  pendingTools: { name: string; order: number; params: Record<string, unknown> }[];
  messages: { role: 'user' | 'assistant'; content: string }[];
}

/**
 * Récupère le contexte de conversation depuis ConversationState
 */
async function getConversationContext(phone: string): Promise<ConversationContext> {
  const state = await prisma.conversationState.findUnique({
    where: { telephone: phone },
  });
  
  if (!state?.data) {
    return { entities: {}, pendingTools: [], messages: [] };
  }
  
  const data = state.data as Record<string, unknown>;
  return {
    intent: data.intent as string | undefined,
    entities: (data.entities as ConversationContext['entities']) || {},
    pendingTools: (data.pendingTools as ConversationContext['pendingTools']) || [],
    messages: (data.messages as ConversationContext['messages']) || [],
  };
}

/**
 * Sauvegarde le contexte de conversation
 */
async function saveConversationContext(phone: string, context: ConversationContext): Promise<void> {
  await prisma.conversationState.upsert({
    where: { telephone: phone },
    create: {
      telephone: phone,
      step: context.intent || 'idle',
      data: JSON.parse(JSON.stringify(context)),
    },
    update: {
      step: context.intent || 'idle',
      data: JSON.parse(JSON.stringify(context)),
    },
  });
}

/**
 * Point d'entrée principal - Simplifié
 * - Utilisateur existe → LLM analyse la demande
 * - Nouvel utilisateur → LLM demande le nom
 */
export async function handleIncomingMessage(ctx: MessageContext) {
  const { from, text } = ctx;
  const phone = normalizePhone(from);

  console.log(`[Bot] Message reçu de ${phone}: "${text}"`);

  try {
    // Vérifier si l'utilisateur existe
    const user = await prisma.utilisateur.findUnique({
      where: { telephone: phone },
      include: { entreprise: true },
    });

    if (user && user.entreprise.nom !== 'En cours de création') {
      // UTILISATEUR EXISTANT → LLM analyse la demande avec contexte
      console.log(`[Bot] Utilisateur existant: ${user.nom} (${user.entreprise.nom})`);
      
      // Charger le contexte de conversation
      const context = await getConversationContext(phone);
      
      // Ajouter le nouveau message à l'historique
      context.messages.push({ role: 'user', content: text });
      // Garder seulement les 10 derniers messages
      if (context.messages.length > 10) {
        context.messages = context.messages.slice(-10);
      }
      
      // Appeler le LLM avec le contexte (from = numéro WhatsApp original)
      const { response, newContext } = await handleUserMessage(text, user, context, from);
      
      // Ajouter la réponse à l'historique
      newContext.messages.push({ role: 'assistant', content: response });
      
      // Sauvegarder le contexte mis à jour
      await saveConversationContext(phone, newContext);
      
      await sendWhatsAppText(from, response);
    } else {
      // NOUVEL UTILISATEUR → LLM demande le nom
      console.log(`[Bot] Nouvel utilisateur, onboarding`);
      const response = await handleNewUser(text, phone);
      await sendWhatsAppText(from, response);
    }

  } catch (error) {
    console.error('[Bot] Erreur:', error);
    await sendWhatsAppText(from, '❌ Une erreur est survenue. Réessayez.');
  }
}

/**
 * Gère les messages d'un utilisateur existant via LLM avec contexte
 */
async function handleUserMessage(
  userMessage: string, 
  user: any, 
  context: ConversationContext,
  whatsappFrom: string  // Numéro WhatsApp original (avec préfixe whatsapp:)
): Promise<{ response: string; newContext: ConversationContext }> {
  
  // Construire l'historique pour le LLM
  const historyText = context.messages
    .slice(-6) // Garder les 6 derniers messages
    .map(m => `${m.role === 'user' ? 'UTILISATEUR' : 'ASSISTANT'}: ${m.content}`)
    .join('\n');

  // Résumé du contexte actuel
  const currentContext = context.intent ? `
OPÉRATION EN COURS: ${context.intent}
INFORMATIONS DÉJÀ COLLECTÉES:
${context.entities.clientName ? `- Client: ${context.entities.clientName}` : ''}
${context.entities.companyName ? `- Entreprise client: ${context.entities.companyName}` : ''}
${context.entities.amount ? `- Montant: ${context.entities.amount}€` : ''}
${context.entities.description ? `- Description: ${context.entities.description}` : ''}
${context.entities.quantity ? `- Quantité: ${context.entities.quantity}` : ''}
`.trim() : 'Aucune opération en cours.';

  const systemPrompt = `Tu es l'assistant intelligent de FactureDirect, une application de facturation via WhatsApp.

IMPORTANT: Tu parles à ${user.nom} qui est UTILISATEUR de l'application (pas un client).
Quand il dit "pour Jean", Jean est le CLIENT à qui il veut facturer.

CONTEXTE UTILISATEUR:
- Nom: ${user.nom}
- Son entreprise: ${user.entreprise.nom}

${currentContext}

HISTORIQUE DE CONVERSATION:
${historyText || 'Début de conversation'}

TES TOOLS DISPONIBLES:
1. searchClient - Rechercher un client par nom
2. createClient - Créer un nouveau client (nécessite: nom)
3. getClients - Lister tous les clients
4. createDevis - Créer un devis (nécessite: clientId, lignes)
5. getDevis - Lister les devis
6. createFacture - Créer une facture (nécessite: clientId, lignes avec description/quantité/prix)
7. getFactures - Lister les factures
8. validateFacture - Valider la dernière facture brouillon (aucune info nécessaire)

9. getEntrepriseSettings - Voir les paramètres de l'entreprise
10. updateEntrepriseSettings - Modifier les paramètres (nécessite: settingName, settingValue)

COMMANDES RAPIDES (intent direct, ready_to_execute: true):
- "valider" / "ok" / "c'est bon" → intent: validate_facture
- "mes factures" / "voir factures" → intent: list_factures
- "mes devis" / "voir devis" → intent: list_devis
- "paramètres" / "mes infos" / "mon entreprise" → intent: settings
- "modifier mon IBAN en XXX" → intent: update_settings (avec settingName: "iban", settingValue: "XXX")

RÈGLES IMPORTANTES:

1. ACCUMULE LES INFORMATIONS: Si une opération est en cours, fusionne les nouvelles infos avec celles déjà collectées.

2. NE REDEMANDE PAS ce qui a déjà été donné. Regarde "INFORMATIONS DÉJÀ COLLECTÉES".

3. POUR CRÉER UNE FACTURE, il faut:
   - Le nom du CLIENT (la personne/entreprise à facturer)
   - La description de la prestation
   - Le montant ou (quantité + prix unitaire)

4. Si l'utilisateur donne une info partielle, fusionne-la avec le contexte et demande UNIQUEMENT ce qui manque.

5. Quand tu as TOUTES les infos → indique ready_to_execute: true

RÉPONDS EN JSON:
{
  "intent": "l'intention (create_facture, create_devis, list_factures, list_devis, validate_facture, settings, update_settings, greeting, help)",
  "entities": {
    "clientName": "nom du client à facturer ou null",
    "companyName": "entreprise du client ou null",
    "amount": montant total ou null,
    "description": "description prestation ou null",
    "quantity": quantité ou null,
    "unitPrice": prix unitaire ou null,
    "settingName": "nom du paramètre à modifier (iban, adresse, siren, etc.) ou null",
    "settingValue": "nouvelle valeur du paramètre ou null"
  },
  "tools": [{"name": "tool", "order": 1}],
  "missing_info": ["UNIQUEMENT ce qui manque encore"],
  "ready_to_execute": true ou false,
  "response": "Ta réponse conversationnelle"
}`;

  console.log('[LLM] Appel avec contexte:', context.intent || 'nouveau');
  
  const result = await callGroqLLM(systemPrompt, userMessage);
  
  // Parser la réponse
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      // Nettoyer le JSON des caractères problématiques
      const cleanJson = jsonMatch[0]
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')  // Supprimer caractères de contrôle
        .replace(/\r?\n/g, ' ')                        // Remplacer newlines par espaces
        .replace(/\s+/g, ' ');                         // Normaliser les espaces
      
      let parsed;
      try {
        parsed = JSON.parse(cleanJson);
      } catch (parseErr) {
        // Si le parsing échoue, essayer de récupérer les valeurs manuellement
        console.log('[LLM] Parsing JSON échoué, tentative extraction manuelle');
        const intentMatch = cleanJson.match(/"intent"\s*:\s*"([^"]+)"/);
        const clientMatch = cleanJson.match(/"clientName"\s*:\s*"([^"]+)"/);
        const companyMatch = cleanJson.match(/"companyName"\s*:\s*"([^"]+)"/);
        const amountMatch = cleanJson.match(/"amount"\s*:\s*(\d+)/);
        const descMatch = cleanJson.match(/"description"\s*:\s*"([^"]+)"/);
        const responseMatch = cleanJson.match(/"response"\s*:\s*"([^"]+)"/);
        const readyMatch = cleanJson.match(/"ready_to_execute"\s*:\s*(true|false)/);
        
        parsed = {
          intent: intentMatch?.[1] || context.intent || 'unknown',
          entities: {
            clientName: clientMatch?.[1] || null,
            companyName: companyMatch?.[1] || null,
            amount: amountMatch ? parseInt(amountMatch[1]) : null,
            description: descMatch?.[1] || null,
          },
          tools: [{ name: 'searchClient', order: 1 }, { name: 'createFacture', order: 2 }],
          missing_info: [],
          ready_to_execute: readyMatch?.[1] === 'true',
          response: responseMatch?.[1] || 'Je traite votre demande...',
        };
      }
      
      console.log('[LLM] Analyse:', JSON.stringify(parsed, null, 2));
      
      // Fusionner les entités (nouvelles + anciennes)
      const mergedEntities = {
        clientName: parsed.entities?.clientName || context.entities.clientName,
        companyName: parsed.entities?.companyName || context.entities.companyName,
        amount: parsed.entities?.amount || context.entities.amount,
        description: parsed.entities?.description || context.entities.description,
        quantity: parsed.entities?.quantity || context.entities.quantity,
        settingName: parsed.entities?.settingName || context.entities.settingName,
        settingValue: parsed.entities?.settingValue || context.entities.settingValue,
      };
      
      // Nouveau contexte
      const newContext: ConversationContext = {
        intent: parsed.intent,
        entities: mergedEntities,
        pendingTools: parsed.tools || [],
        messages: context.messages,
      };
      
      // Si greeting/help → réponse simple, reset contexte complet
      if (['greeting', 'help', 'unclear', 'out_of_scope'].includes(parsed.intent)) {
        return {
          response: parsed.response,
          newContext: { entities: {}, pendingTools: [], messages: [] },
        };
      }
      
      // Si prêt à exécuter → EXÉCUTER LES TOOLS
      if (parsed.ready_to_execute && parsed.tools?.length > 0) {
        console.log('[Bot] Exécution des tools...');
        
        const executionResult = await executeTools(
          parsed.intent,
          mergedEntities,
          parsed.tools,
          user,
          whatsappFrom  // Utiliser le numéro WhatsApp original
        );
        
        // Reset COMPLET du contexte après exécution (nouvelle conversation)
        const resetContext: ConversationContext = {
          intent: undefined,
          entities: {},
          pendingTools: [],
          messages: [],  // Vider l'historique pour démarrer une nouvelle conversation
        };
        
        return { response: executionResult, newContext: resetContext };
      }
      
      // Construire la réponse (pas encore prêt à exécuter)
      let response = '';
      
      // Résumé des infos collectées
      if (mergedEntities.clientName || mergedEntities.amount || mergedEntities.description) {
        response += `📋 *Récapitulatif:*\n`;
        if (mergedEntities.clientName) response += `• Client: ${mergedEntities.clientName}${mergedEntities.companyName ? ` (${mergedEntities.companyName})` : ''}\n`;
        if (mergedEntities.description) response += `• Prestation: ${mergedEntities.description}\n`;
        if (mergedEntities.amount) response += `• Montant: ${mergedEntities.amount}€\n`;
        if (mergedEntities.quantity) response += `• Quantité: ${mergedEntities.quantity}\n`;
        response += `\n`;
      }
      
      // Ce qui manque
      if (parsed.missing_info?.length > 0) {
        response += `⚠️ *Il me manque:*\n`;
        parsed.missing_info.forEach((info: string) => {
          response += `• ${info}\n`;
        });
        response += `\n`;
      }
      
      response += `💬 ${parsed.response}`;
      
      return { response, newContext };
    }
  } catch (e) {
    console.log('[LLM] Erreur parsing:', e);
  }
  
  return { 
    response: result, 
    newContext: context 
  };
}

/**
 * Exécute les tools et retourne le résultat formaté
 */
async function executeTools(
  intent: string,
  entities: ConversationContext['entities'],
  toolsList: { name: string; order: number; params?: Record<string, unknown> }[],
  user: any,
  phoneNumber: string
): Promise<string> {
  console.log('[Tools] Exécution pour intent:', intent);
  console.log('[Tools] Entités:', entities);
  
  const entrepriseId = user.entreprise.id;
  const userId = user.id;
  
  try {
    // Selon l'intention, exécuter les actions appropriées
    switch (intent) {
      case 'create_facture': {
        // 1. Chercher ou créer le client
        let clientId: string | null = null;
        
        if (entities.clientName) {
          // Chercher le client existant
          const searchResult = await tools.searchClient(entrepriseId, entities.clientName);
          
          if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
            // Client trouvé
            clientId = searchResult.data[0].id;
            console.log('[Tools] Client trouvé:', searchResult.data[0].nom);
          } else {
            // Créer le client
            const createResult = await tools.createClient(entrepriseId, {
              nom: entities.clientName + (entities.companyName ? ` - ${entities.companyName}` : ''),
            });
            
            if (createResult.success && createResult.data) {
              clientId = createResult.data.id;
              console.log('[Tools] Client créé:', createResult.data.nom);
            }
          }
        }
        
        if (!clientId) {
          return '❌ Impossible de créer la facture : client non identifié.';
        }
        
        // 2. Créer la facture
        const lignes = [{
          description: entities.description || 'Prestation',
          quantite: entities.quantity || 1,
          prixUnitaireHT: entities.amount || 0,
          tauxTVA: 20,
        }];
        
        const factureResult = await tools.createFacture(entrepriseId, userId, {
          clientId,
          lignes,
        });
        
        if (!factureResult.success || !factureResult.data) {
          return `❌ Erreur lors de la création de la facture : ${factureResult.error}`;
        }
        
        const facture = factureResult.data;
        
        // 3. Générer et envoyer le PDF
        console.log('[Tools] Génération et envoi du PDF facture...');
        const pdfResult = await tools.generateAndSendFacturePDF(facture.id, phoneNumber);
        
        if (!pdfResult.success) {
          console.error('[Tools] Erreur PDF:', pdfResult.error);
          // On continue quand même, la facture est créée
        }
        
        return `✅ *Facture créée avec succès !*\n\n` +
          `📄 *Numéro:* ${facture.numero}\n` +
          `👤 *Client:* ${facture.client.nom}\n` +
          `📝 *Prestation:* ${entities.description || 'Prestation'}\n` +
          `💰 *Total HT:* ${facture.totalHT.toFixed(2)}€\n` +
          `💰 *Total TTC:* ${facture.totalTTC.toFixed(2)}€\n\n` +
          `_La facture est en statut BROUILLON. Tapez "valider" pour la finaliser._`;
      }
      
      case 'create_devis': {
        // Similaire à create_facture
        let clientId: string | null = null;
        
        if (entities.clientName) {
          const searchResult = await tools.searchClient(entrepriseId, entities.clientName);
          
          if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
            clientId = searchResult.data[0].id;
          } else {
            const createResult = await tools.createClient(entrepriseId, {
              nom: entities.clientName + (entities.companyName ? ` - ${entities.companyName}` : ''),
            });
            if (createResult.success && createResult.data) {
              clientId = createResult.data.id;
            }
          }
        }
        
        if (!clientId) {
          return '❌ Impossible de créer le devis : client non identifié.';
        }
        
        const lignes = [{
          description: entities.description || 'Prestation',
          quantite: entities.quantity || 1,
          prixUnitaireHT: entities.amount || 0,
        }];
        
        const devisResult = await tools.createDevis(entrepriseId, {
          clientId,
          lignes,
        });
        
        if (!devisResult.success || !devisResult.data) {
          return `❌ Erreur lors de la création du devis : ${devisResult.error}`;
        }
        
        const devis = devisResult.data;
        
        // Générer et envoyer le PDF
        console.log('[Tools] Génération et envoi du PDF devis...');
        const pdfResult = await tools.generateAndSendDevisPDF(devis.id, phoneNumber);
        
        if (!pdfResult.success) {
          console.error('[Tools] Erreur PDF devis:', pdfResult.error);
        }
        
        return `✅ *Devis créé avec succès !*\n\n` +
          `📄 *Numéro:* ${devis.numero}\n` +
          `👤 *Client:* ${devis.client.nom}\n` +
          `📝 *Prestation:* ${entities.description || 'Prestation'}\n` +
          `💰 *Total HT:* ${devis.totalHT.toFixed(2)}€\n` +
          `💰 *Total TTC:* ${devis.totalTTC.toFixed(2)}€\n`;
      }
      
      case 'list_factures': {
        const result = await tools.getFactures(entrepriseId, 10);
        
        if (!result.success || !result.data || result.data.length === 0) {
          return '📭 Aucune facture trouvée.\n\nDites "créer une facture" pour commencer.';
        }
        
        let response = `🧾 *Vos factures* (${result.data.length})\n\n`;
        
        result.data.forEach((f, i) => {
          const statutIcon = f.statut === 'VALIDEE' ? '✅' : f.statut === 'PAYEE' ? '💰' : '📝';
          response += `${i + 1}. *${f.numero}* ${statutIcon}\n`;
          response += `   👤 ${f.client.nom}\n`;
          response += `   💰 ${f.totalTTC.toFixed(2)}€ TTC\n\n`;
        });
        
        return response;
      }
      
      case 'list_devis': {
        const result = await tools.getDevis(entrepriseId, 10);
        
        if (!result.success || !result.data || result.data.length === 0) {
          return '📭 Aucun devis trouvé.\n\nDites "créer un devis" pour commencer.';
        }
        
        let response = `📋 *Vos devis* (${result.data.length})\n\n`;
        
        result.data.forEach((d, i) => {
          const statutIcon = d.statut === 'accepté' ? '✅' : d.statut === 'refusé' ? '❌' : '⏳';
          response += `${i + 1}. *${d.numero}* ${statutIcon}\n`;
          response += `   👤 ${d.client.nom}\n`;
          response += `   💰 ${d.totalHT.toFixed(2)}€ HT\n\n`;
        });
        
        return response;
      }
      
      case 'search_client': {
        if (!entities.clientName) {
          return '❌ Aucun nom de client à rechercher.';
        }
        
        const result = await tools.searchClient(entrepriseId, entities.clientName);
        
        if (!result.success || !result.data || result.data.length === 0) {
          return `🔍 Aucun client trouvé pour "${entities.clientName}".\n\nVoulez-vous créer ce client ?`;
        }
        
        let response = `🔍 *Clients trouvés* (${result.data.length})\n\n`;
        
        result.data.forEach((c, i) => {
          response += `${i + 1}. *${c.nom}*\n`;
          if (c.adresse) response += `   📍 ${c.adresse}\n`;
          response += `\n`;
        });
        
        return response;
      }
      
      case 'create_client': {
        if (!entities.clientName) {
          return '❌ Nom du client requis pour la création.';
        }
        
        const result = await tools.createClient(entrepriseId, {
          nom: entities.clientName + (entities.companyName ? ` - ${entities.companyName}` : ''),
        });
        
        if (!result.success || !result.data) {
          return `❌ Erreur : ${result.error}`;
        }
        
        return `✅ *Client créé !*\n\n👤 ${result.data.nom}`;
      }
      
      case 'settings':
      case 'view_settings': {
        // Afficher les paramètres de l'entreprise
        const result = await tools.getEntrepriseSettings(entrepriseId);
        
        if (!result.success || !result.data) {
          return `❌ Erreur : ${result.error}`;
        }
        
        const e = result.data;
        let response = `⚙️ *Paramètres de votre entreprise*\n\n`;
        response += `🏢 *Nom:* ${e.nom}\n`;
        if (e.siren) response += `📋 *SIREN:* ${e.siren}\n`;
        if (e.tvaIntra) response += `🇪🇺 *TVA Intra:* ${e.tvaIntra}\n`;
        response += `\n📍 *Adresse:*\n`;
        if (e.adresse) response += `${e.adresse}\n`;
        if (e.codePostal || e.ville) response += `${e.codePostal || ''} ${e.ville || ''}\n`;
        response += `\n💳 *Coordonnées bancaires:*\n`;
        if (e.iban) response += `IBAN: ${e.iban}\n`;
        if (e.bic) response += `BIC: ${e.bic}\n`;
        response += `\n📊 *TVA:*\n`;
        response += `Régime: ${e.regimeTVA}\n`;
        response += `\n_Pour modifier, dites par exemple "changer mon adresse" ou "modifier mon IBAN"._`;
        
        return response;
      }
      
      case 'update_settings': {
        // Modifier les paramètres de l'entreprise
        const updates: Record<string, string | null> = {};
        
        // Extraire les modifications demandées depuis les entités
        if (entities.settingName && entities.settingValue) {
          const fieldMap: Record<string, string> = {
            'nom': 'nom',
            'adresse': 'adresse',
            'code postal': 'codePostal',
            'ville': 'ville',
            'siren': 'siren',
            'tva': 'tvaIntra',
            'iban': 'iban',
            'bic': 'bic',
            'mentions': 'mentionsLegales',
          };
          
          const field = fieldMap[entities.settingName.toLowerCase()] || entities.settingName;
          updates[field] = entities.settingValue;
        }
        
        if (Object.keys(updates).length === 0) {
          return '❌ Précisez ce que vous souhaitez modifier.\n\nExemple: "Modifier mon IBAN en FR76..."';
        }
        
        const result = await tools.updateEntrepriseSettings(entrepriseId, updates);
        
        if (!result.success) {
          return `❌ Erreur : ${result.error}`;
        }
        
        return `✅ *Paramètres mis à jour !*\n\nTapez "paramètres" pour voir vos informations.`;
      }
      
      case 'validate_facture': {
        // Chercher la dernière facture BROUILLON de l'utilisateur
        const factures = await prisma.facture.findMany({
          where: { 
            entrepriseId,
            statut: 'BROUILLON',
          },
          include: { client: true },
          orderBy: { dateCreation: 'desc' },
          take: 1,
        });
        
        if (factures.length === 0) {
          return '❌ Aucune facture en brouillon à valider.\n\nCréez d\'abord une facture.';
        }
        
        const facture = factures[0];
        
        // Valider la facture
        const validateResult = await tools.validateFacture(facture.id, userId);
        
        if (!validateResult.success || !validateResult.data) {
          return `❌ Erreur lors de la validation : ${validateResult.error}`;
        }
        
        // Régénérer et envoyer le PDF validé
        console.log('[Tools] Régénération du PDF après validation...');
        const pdfResult = await tools.generateAndSendFacturePDF(facture.id, phoneNumber);
        
        if (!pdfResult.success) {
          console.error('[Tools] Erreur PDF validation:', pdfResult.error);
        }
        
        return `✅ *Facture validée !*\n\n` +
          `📄 *Numéro:* ${validateResult.data.numero}\n` +
          `👤 *Client:* ${validateResult.data.client.nom}\n` +
          `💰 *Total TTC:* ${validateResult.data.totalTTC.toFixed(2)}€\n\n` +
          `_La facture définitive vous a été envoyée._`;
      }
      
      default:
        return `⚠️ Action "${intent}" non implémentée pour le moment.`;
    }
    
  } catch (error) {
    console.error('[Tools] Erreur:', error);
    return `❌ Une erreur est survenue lors de l'exécution.`;
  }
}

/**
 * Gère les nouveaux utilisateurs - demande le nom
 */
async function handleNewUser(userMessage: string, phone: string): Promise<string> {
  // Vérifier si on a déjà un état de conversation
  const convState = await prisma.conversationState.findUnique({
    where: { telephone: phone },
  });

  const systemPrompt = `Tu es l'assistant de FactureDirect, une application de facturation.

Un nouvel utilisateur vient de te contacter. Tu dois l'accueillir et lui demander son nom pour créer son compte.

${convState?.data ? `Données déjà collectées: ${JSON.stringify(convState.data)}` : 'Premier contact avec cet utilisateur.'}

Si l'utilisateur donne son nom dans son message, extrais-le.
Sois chaleureux, professionnel et concis.

RÉPONDS EN JSON:
{
  "extracted_name": "nom extrait ou null si pas de nom détecté",
  "response": "Ta réponse à l'utilisateur"
}`;

  const result = await callGroqLLM(systemPrompt, userMessage);
  
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Si un nom a été extrait, sauvegarder dans ConversationState
      if (parsed.extracted_name && parsed.extracted_name !== 'null') {
        console.log(`[Bot] Nom extrait: ${parsed.extracted_name}`);
        await prisma.conversationState.upsert({
          where: { telephone: phone },
          create: {
            telephone: phone,
            step: 'onboarding_name_received',
            data: { nom: parsed.extracted_name },
          },
          update: {
            step: 'onboarding_name_received',
            data: { nom: parsed.extracted_name },
          },
        });
      }
      
      return parsed.response;
    }
  } catch (e) {
    console.log('[LLM] Réponse non-JSON pour onboarding');
  }
  
  return result;
}

/**
 * Appel générique à l'API Groq
 */
async function callGroqLLM(systemPrompt: string, userMessage: string): Promise<string> {
  console.log('[LLM] GROQ_API_KEY présente:', !!process.env.GROQ_API_KEY);
  
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  console.log('[LLM] Status:', response.status);

  if (!response.ok) {
    const error = await response.text();
    console.error('[LLM] Erreur:', error);
    throw new Error(`API Groq: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content.trim();
  console.log('[LLM] Réponse:', content.substring(0, 200));
  
  return content;
}
