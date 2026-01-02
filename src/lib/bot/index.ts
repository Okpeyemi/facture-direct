// src/lib/bot/index.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';
import { handleOnboarding } from './onboarding';
import { handleDevisCreation, handleDevisFlowResponse } from './devis/index';
import { handleFactureCreation, handleFactureFlowResponse, handleValidateFacture } from './facture/index';
import { handleChat } from './chat';
import { normalizePhone } from './utils/phone';
import { detectIntent } from './utils/intent';

interface MessageContext {
  from: string;
  text: string;
  isVoice: boolean;
}

export async function handleIncomingMessage(ctx: MessageContext) {
  const { from, text } = ctx;
  const phone = normalizePhone(from);
  const lowerText = text.toLowerCase().trim();

  console.log(`[Bot] Traitement message pour ${phone} (Original: ${from})`);

  try {
    const user = await prisma.utilisateur.findUnique({
      where: { telephone: phone },
      include: { entreprise: true },
    });

    // Utilisateur inscrit et entreprise valide
    if (user && user.entreprise.nom !== 'En cours de création') {
      console.log(`[Bot] Utilisateur existant trouvé: ${user.id} (${user.role})`);

      // 1. Vérifier s'il y a un draft actif (devis ou facture)
      const activeDevisDraft = await prisma.devisDraft.findFirst({
        where: { utilisateurId: user.id, status: 'active' },
        orderBy: { updatedAt: 'desc' },
      });

      const activeFactureDraft = await prisma.factureDraft.findFirst({
        where: { utilisateurId: user.id, status: 'active' },
        orderBy: { updatedAt: 'desc' },
      });

      // 2. Commandes EXPLICITES (match exact sur le texte, pas LLM)
      const explicitCommands: Record<string, string> = {
        'menu': 'show_menu',
        '/menu': 'show_menu',
        'annuler': 'cancel',
        'stop': 'cancel',
        'quitter': 'cancel',
        'abandonner': 'cancel',
        'valider': 'validate_facture',
        'resume': 'resume_status',
        'reprendre': 'resume_status',
        'statut': 'resume_status',
        'où en suis-je': 'resume_status',
      };
      const explicitIntent = explicitCommands[lowerText];

      // 3. Si commande explicite d'annulation
      if ((activeDevisDraft || activeFactureDraft) && explicitIntent === 'cancel') {
        if (activeDevisDraft) await prisma.devisDraft.delete({ where: { id: activeDevisDraft.id } });
        if (activeFactureDraft) await prisma.factureDraft.delete({ where: { id: activeFactureDraft.id } });
        await sendWhatsAppText(from, '❌ Opération annulée.\n\nQue souhaitez-vous faire ? Tapez *menu* pour voir les options.');
        return;
      }

      // 4. Si commande explicite menu
      if (explicitIntent === 'show_menu') {
        // Supprimer les drafts actifs
        if (activeDevisDraft) await prisma.devisDraft.delete({ where: { id: activeDevisDraft.id } });
        if (activeFactureDraft) await prisma.factureDraft.delete({ where: { id: activeFactureDraft.id } });
        await sendWhatsAppText(
          from,
          `📋 Menu FactureDirect\n\n` +
          `• Créer un devis\n` +
          `• Créer une facture\n` +
          `• Voir mes devis\n` +
          `• Voir mes factures\n` +
          `• Ajouter un client\n` +
          `• Paramètres entreprise\n\n` +
          `Dites-moi ce que vous voulez faire !`
        );
        return;
      }

      // 5. Si commande "valider" → valider la dernière facture brouillon
      if (explicitIntent === 'validate_facture') {
        return await handleValidateFacture(from, user);
      }

      // 6. Si commande "resume" → afficher le statut actuel
      if (explicitIntent === 'resume_status') {
        return await handleResumeStatus(from, user, activeDevisDraft, activeFactureDraft);
      }

      // 7. Si draft devis actif → traiter comme réponse au flux devis
      if (activeDevisDraft) {
        console.log(`[Bot] Draft devis actif (${activeDevisDraft.step}), traitement comme réponse`);
        return await handleDevisFlowResponse(from, phone, user, text, activeDevisDraft);
      }

      // 7. Si draft facture actif → traiter comme réponse au flux facture
      if (activeFactureDraft) {
        console.log(`[Bot] Draft facture actif (${activeFactureDraft.step}), traitement comme réponse`);
        return await handleFactureFlowResponse(from, phone, user, text, activeFactureDraft);
      }

      // 6. Pas de draft actif → Détection d'intention normale via LLM
      const intent = await detectIntent(text);
      console.log(`[Bot] Intent détectée pour ${phone} :`, intent);

      switch (intent) {
        case 'create_devis':
          // Supprimer les anciens drafts avant d'en créer un nouveau
          await prisma.devisDraft.deleteMany({
            where: { utilisateurId: user.id, status: { in: ['active', 'paused'] } },
          });
          return await handleDevisCreation(from, phone, user);

        case 'create_facture':
          // Supprimer les anciens drafts avant d'en créer un nouveau
          await prisma.factureDraft.deleteMany({
            where: { utilisateurId: user.id, status: { in: ['active'] } },
          });
          return await handleFactureCreation(from, phone, user);

        case 'list_devis':
          await sendWhatsAppText(from, '📋 Voici vos 3 derniers devis :\n- DEV-2025-012 → Martin SARL (1 800 €)\n- DEV-2025-011 → Dubois SAS (2 400 €)\n- DEV-2025-010 → Léa Dupont (900 €)');
          return;

        case 'list_factures':
          await sendWhatsAppText(from, '📊 Voici vos 3 dernières factures :\n- FACT-2025-087 → Payée\n- FACT-2025-086 → En attente\n- FACT-2025-085 → Payée');
          return;

        case 'show_menu':
          await sendWhatsAppText(
            from,
            `📋 Menu FactureDirect\n\n` +
            `• Créer un devis\n` +
            `• Créer une facture\n` +
            `• Voir mes devis\n` +
            `• Voir mes factures\n` +
            `• Ajouter un client\n` +
            `• Paramètres entreprise\n\n` +
            `Dites-moi ce que vous voulez faire !`
          );
          return;

        case 'chat':
          return await handleChat(from, user, text);

        default:
          return await handleChat(from, user, text);
      }
    }

    // Onboarding pour les nouveaux utilisateurs
    console.log(`[Bot] Utilisateur non trouvé ou incomplet, passage au onboarding`);
    
    // Si commande "resume" pendant l'onboarding
    if (lowerText === 'resume' || lowerText === 'reprendre' || lowerText === 'statut') {
      const state = await prisma.conversationState.findUnique({ where: { telephone: phone } });
      if (state) {
        const onboardingSteps: Record<string, string> = {
          'onboarding_welcome': 'Bienvenue',
          'onboarding_nom_entreprise': 'Nom de l\'entreprise',
          'onboarding_adresse': 'Adresse',
          'onboarding_siren': 'Numéro SIREN',
          'onboarding_regime_tva': 'Régime TVA',
          'onboarding_nom_user': 'Votre nom',
          'onboarding_email': 'Votre email',
        };
        const stepLabel = onboardingSteps[state.step] || state.step;
        await sendWhatsAppText(
          from,
          `📊 *STATUT ONBOARDING*\n\n` +
          `🚀 *Inscription en cours*\n` +
          `• Étape actuelle : ${stepLabel}\n\n` +
          `_Répondez à la question pour continuer ou tapez *annuler* pour recommencer._`
        );
        return;
      }
    }
    
    await handleOnboarding(from, phone, text);

  } catch (error) {
    console.error('Erreur dans handleIncomingMessage:', error);
    await sendWhatsAppText(from, 'Désolé, une erreur technique est survenue. Réessayez dans quelques instants.');
  }
}

/**
 * Affiche le statut actuel de l'utilisateur (drafts en cours, onboarding, etc.)
 */
async function handleResumeStatus(from: string, user: any, activeDevisDraft: any, activeFactureDraft: any) {
  const stepLabels: Record<string, string> = {
    // Devis
    'asking_client': 'Sélection du client',
    'asking_new_client_name': 'Nom du nouveau client',
    'asking_new_client_address': 'Adresse du nouveau client',
    'creating_client': 'Confirmation du client',
    'asking_lignes': 'Lignes du devis',
    'asking_validite': 'Validité du devis',
    'asking_conditions': 'Conditions de paiement',
    // Facture
    'choosing_source': 'Choix de la source',
    'selecting_devis': 'Sélection du devis',
    'confirming': 'Confirmation',
    'asking_validation': 'Validation de la facture',
  };

  let message = '📊 *STATUT ACTUEL*\n\n';

  if (activeDevisDraft) {
    const stepLabel = stepLabels[activeDevisDraft.step] || activeDevisDraft.step;
    const data = activeDevisDraft.data || {};
    
    message += '📝 *Devis en cours de création*\n';
    message += `• Étape : ${stepLabel}\n`;
    if (data.clientNom) message += `• Client : ${data.clientNom}\n`;
    if (data.lignes?.length) message += `• Lignes : ${data.lignes.length} ligne(s)\n`;
    message += '\n';
    message += '_Tapez votre réponse pour continuer ou *annuler* pour abandonner._\n';
  } else if (activeFactureDraft) {
    const stepLabel = stepLabels[activeFactureDraft.step] || activeFactureDraft.step;
    const data = activeFactureDraft.data || {};
    
    message += '🧾 *Facture en cours de création*\n';
    message += `• Étape : ${stepLabel}\n`;
    if (data.clientNom) message += `• Client : ${data.clientNom}\n`;
    if (data.lignes?.length) message += `• Lignes : ${data.lignes.length} ligne(s)\n`;
    if (data.totalTTC) message += `• Total TTC : ${data.totalTTC.toFixed(2)}€\n`;
    message += '\n';
    message += '_Tapez votre réponse pour continuer ou *annuler* pour abandonner._\n';
  } else {
    // Vérifier s'il y a des factures brouillon à valider
    const factureBrouillon = await prisma.facture.findFirst({
      where: { entrepriseId: user.entreprise.id, statut: 'BROUILLON' },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });

    if (factureBrouillon) {
      message += '🧾 *Facture brouillon à valider*\n';
      message += `• Numéro : ${factureBrouillon.numero}\n`;
      message += `• Client : ${factureBrouillon.client.nom}\n`;
      message += `• Total TTC : ${factureBrouillon.totalTTC.toFixed(2)}€\n\n`;
      message += '_Tapez *valider* pour finaliser cette facture._\n';
    } else {
      message += '✅ *Aucune opération en cours*\n\n';
      message += 'Vous pouvez :\n';
      message += '• Tapez *Créer un devis*\n';
      message += '• Tapez *Créer une facture*\n';
      message += '• Tapez *menu* pour voir toutes les options\n';
    }
  }

  await sendWhatsAppText(from, message);
}