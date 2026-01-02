// src/lib/bot/index.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';
import { handleOnboarding } from './onboarding';
import { handleDevisCreation, handleDevisFlowResponse } from './devis/index';
import { handleFactureCreation, handleFactureFlowResponse, handleValidateFacture, handleModifyFacture, handlePrintFacture } from './facture/index';
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
        'modifier': 'modify_facture',
        'modifier facture': 'modify_facture',
        'imprimer': 'print_facture',
        'reimprimer': 'print_facture',
        'ré-imprimer': 'print_facture',
        'pdf': 'print_facture',
        // Commandes devis
        'mes devis': 'list_devis',
        'voir mes devis': 'list_devis',
        'imprimer devis': 'print_devis',
        'pdf devis': 'print_devis',
        'facturer': 'create_facture_from_devis',
        'transformer en facture': 'create_facture_from_devis',
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

      // 7. Si commande "modifier" → modifier la dernière facture brouillon
      if (explicitIntent === 'modify_facture') {
        return await handleModifyFacture(from, user);
      }

      // 8. Si commande "imprimer" → ré-imprimer une facture
      if (explicitIntent === 'print_facture') {
        return await handlePrintFacture(from, user);
      }

      // 9. Si commande "mes devis" → liste des devis
      if (explicitIntent === 'list_devis') {
        return await handleListDevis(from, user);
      }

      // 10. Si commande "imprimer devis" → imprimer le dernier devis consulté
      if (explicitIntent === 'print_devis') {
        return await handlePrintDevis(from, user);
      }

      // 11. Si commande "facturer" → créer facture depuis le dernier devis
      if (explicitIntent === 'create_facture_from_devis') {
        return await handleFactureCreation(from, phone, user);
      }

      // 12. Si l'utilisateur tape un numéro simple (1, 2, 3...) → sélection de devis
      const numMatch = lowerText.match(/^(\d+)$/);
      if (numMatch && !activeDevisDraft && !activeFactureDraft) {
        const num = parseInt(numMatch[1]);
        // Récupérer les devis récents de l'utilisateur
        const devisRecents = await prisma.devis.findMany({
          where: { entrepriseId: user.entreprise.id },
          include: { client: true, lignes: true, facture: true },
          orderBy: { date: 'desc' },
          take: 10,
        });
        
        if (devisRecents.length > 0 && num >= 1 && num <= devisRecents.length) {
          return await handleDevisDetails(from, user, devisRecents[num - 1]);
        }
      }

      // 10. Si draft devis actif → traiter comme réponse au flux devis
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
          return await handleListDevis(from, user);

        case 'list_factures':
          return await handleListFactures(from, user);

        case 'settings':
          return await handleSettings(from, user);

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

/**
 * Affiche la liste des devis réels de l'utilisateur avec actions possibles.
 */
async function handleListDevis(from: string, user: any) {
  const devis = await prisma.devis.findMany({
    where: { entrepriseId: user.entreprise.id },
    include: { client: true, lignes: true, facture: true },
    orderBy: { date: 'desc' },
    take: 10,
  });

  if (devis.length === 0) {
    await sendWhatsAppText(
      from,
      `📋 *MES DEVIS*\n\n` +
      `Vous n'avez aucun devis pour le moment.\n\n` +
      `Tapez *Créer un devis* pour commencer.`
    );
    return;
  }

  let message = `📋 *MES DEVIS* (${devis.length})\n\n`;

  devis.forEach((d, i) => {
    // Calculer le total HT à partir des lignes
    const totalHT = d.lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT, 0);
    const statutIcon = d.statut === 'accepté' ? '✅' : d.statut === 'refusé' ? '❌' : '⏳';
    const hasFacture = d.facture ? ' 🧾' : '';
    
    message += `${i + 1}. *${d.numero}*${hasFacture}\n`;
    message += `   ${statutIcon} ${d.statut?.toUpperCase() || 'BROUILLON'}\n`;
    message += `   👤 ${d.client.nom}\n`;
    message += `   💰 ${totalHT.toFixed(2)}€ HT\n`;
    message += `   📅 ${d.date.toLocaleDateString('fr-FR')}\n\n`;
  });

  message += `---\n`;
  message += `*Actions disponibles :*\n`;
  message += `• Tapez le *numéro* (ex: 1) pour voir les détails\n`;
  message += `• Tapez *Créer un devis* pour un nouveau\n`;
  message += `• Tapez *menu* pour revenir au menu`;

  await sendWhatsAppText(from, message);
}

/**
 * Affiche la liste des factures réelles de l'utilisateur avec actions possibles.
 */
async function handleListFactures(from: string, user: any) {
  const factures = await prisma.facture.findMany({
    where: { entrepriseId: user.entreprise.id },
    include: { client: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  if (factures.length === 0) {
    await sendWhatsAppText(
      from,
      `🧾 *MES FACTURES*\n\n` +
      `Vous n'avez aucune facture pour le moment.\n\n` +
      `Tapez *Créer une facture* pour commencer.`
    );
    return;
  }

  let message = `🧾 *MES FACTURES* (${factures.length})\n\n`;

  factures.forEach((f, i) => {
    const statut = f.statut as string;
    const statutIcon = statut === 'VALIDEE' ? '✅' : statut === 'PAYEE' ? '💰' : '⏳';
    const statutText = statut === 'VALIDEE' ? 'VALIDÉE' : statut === 'PAYEE' ? 'PAYÉE' : 'BROUILLON';
    
    message += `${i + 1}. *${f.numero}*\n`;
    message += `   ${statutIcon} ${statutText}\n`;
    message += `   👤 ${f.client.nom}\n`;
    message += `   💰 ${f.totalTTC.toFixed(2)}€ TTC\n`;
    message += `   📅 ${f.dateCreation.toLocaleDateString('fr-FR')}\n\n`;
  });

  message += `---\n`;
  message += `*Actions disponibles :*\n`;
  
  const hasBrouillon = factures.some(f => f.statut === 'BROUILLON');
  if (hasBrouillon) {
    message += `• Tapez *valider* pour valider le dernier brouillon\n`;
    message += `• Tapez *modifier* pour modifier le brouillon\n`;
  }
  message += `• Tapez *imprimer* pour ré-imprimer la dernière facture\n`;
  message += `• Tapez *Créer une facture* pour une nouvelle\n`;
  message += `• Tapez *menu* pour revenir au menu`;

  await sendWhatsAppText(from, message);
}

/**
 * Affiche et permet de modifier les paramètres de l'entreprise.
 */
async function handleSettings(from: string, user: any) {
  const entreprise = user.entreprise;

  let message = `⚙️ *PARAMÈTRES ENTREPRISE*\n\n`;
  
  message += `📋 *Informations générales*\n`;
  message += `• Nom : ${entreprise.nom || '-'}\n`;
  message += `• SIREN : ${entreprise.siren || '-'}\n`;
  message += `• TVA Intra : ${entreprise.tvaIntra || '-'}\n\n`;

  message += `📍 *Adresse*\n`;
  message += `• ${entreprise.adresse || '-'}\n`;
  message += `• ${entreprise.codePostal || ''} ${entreprise.ville || ''}\n\n`;

  message += `💰 *Paramètres facturation*\n`;
  message += `• Régime TVA : ${entreprise.regimeTVA || 'NORMAL'}\n`;
  message += `• Taux TVA par défaut : ${entreprise.tauxTVADefaut || 20}%\n\n`;

  message += `🏦 *Coordonnées bancaires*\n`;
  message += `• IBAN : ${entreprise.iban || '-'}\n`;
  message += `• BIC : ${entreprise.bic || '-'}\n\n`;

  message += `---\n`;
  message += `*Pour modifier un paramètre, tapez :*\n`;
  message += `• "modifier nom [nouveau nom]"\n`;
  message += `• "modifier siren [numéro]"\n`;
  message += `• "modifier adresse [adresse]"\n`;
  message += `• "modifier iban [numéro]"\n`;
  message += `• "modifier tva [taux]"\n\n`;
  message += `_Exemple : "modifier nom Ma Société SARL"_\n\n`;
  message += `Tapez *menu* pour revenir au menu.`;

  await sendWhatsAppText(from, message);
}

/**
 * Affiche les détails d'un devis et propose des actions.
 */
async function handleDevisDetails(from: string, user: any, devis: any) {
  const entreprise = user.entreprise;
  
  // Calculer les totaux
  const totalHT = devis.lignes.reduce((sum: number, l: any) => sum + l.quantite * l.prixUnitaireHT, 0);
  const tauxTVA = entreprise.tauxTVADefaut || 20;
  const totalTVA = totalHT * (tauxTVA / 100);
  const totalTTC = totalHT + totalTVA;

  // Statut
  const statutIcon = devis.statut === 'accepté' ? '✅' : devis.statut === 'refusé' ? '❌' : devis.statut === 'envoyé' ? '📤' : '📋';
  const statutText = devis.statut?.toUpperCase() || 'BROUILLON';
  const hasFacture = devis.facture ? true : false;

  let message = `📋 *DÉTAILS DU DEVIS ${devis.numero}*\n\n`;
  message += `${statutIcon} *Statut : ${statutText}*\n`;
  if (hasFacture) {
    message += `🧾 _Facture associée : ${devis.facture.numero}_\n`;
  }
  message += `\n`;

  message += `👤 *Client :* ${devis.client.nom}\n`;
  if (devis.client.adresse) message += `📍 ${devis.client.adresse}\n`;
  message += `\n`;

  message += `📦 *Lignes :*\n`;
  devis.lignes.forEach((l: any) => {
    const ligneTotal = l.quantite * l.prixUnitaireHT;
    message += `• ${l.quantite} × ${l.description}\n`;
    message += `  ${l.prixUnitaireHT.toFixed(2)}€ HT → *${ligneTotal.toFixed(2)}€*\n`;
  });
  message += `\n`;

  message += `💰 *Totaux :*\n`;
  message += `• Total HT : ${totalHT.toFixed(2)}€\n`;
  message += `• TVA (${tauxTVA}%) : ${totalTVA.toFixed(2)}€\n`;
  message += `• *Total TTC : ${totalTTC.toFixed(2)}€*\n\n`;

  message += `📅 Date : ${devis.date.toLocaleDateString('fr-FR')}\n`;
  message += `⏳ Validité : ${devis.validiteJours} jours\n\n`;

  message += `---\n`;
  message += `*Actions disponibles :*\n`;

  // Actions selon le statut
  if (!hasFacture) {
    if (devis.statut === 'brouillon') {
      message += `• Tapez *modifier devis* pour le modifier\n`;
    }
    if (devis.statut !== 'refusé') {
      message += `• Tapez *facturer* pour créer une facture\n`;
    }
    message += `• Tapez *supprimer devis* pour le supprimer\n`;
  }
  message += `• Tapez *imprimer devis* pour le PDF\n`;
  message += `• Tapez *mes devis* pour revenir à la liste\n`;
  message += `• Tapez *menu* pour le menu principal`;

  await sendWhatsAppText(from, message);
}

/**
 * Génère et envoie le PDF du dernier devis.
 */
async function handlePrintDevis(from: string, user: any) {
  const entreprise = user.entreprise;

  // Trouver le dernier devis
  const devis = await prisma.devis.findFirst({
    where: { entrepriseId: entreprise.id },
    include: { client: true, lignes: true },
    orderBy: { date: 'desc' },
  });

  if (!devis) {
    await sendWhatsAppText(from, '⚠️ Aucun devis à imprimer.\n\nCréez d\'abord un devis avec "Créer un devis".');
    return;
  }

  await sendWhatsAppText(from, `⏳ Génération du PDF du devis ${devis.numero}...`);

  try {
    const { genererDevisPDF } = await import('@/lib/pdf-generator');
    const { uploadPDFTemporary, genererNomFichierDevis } = await import('@/lib/bot/utils/devis');
    const { sendWhatsAppDocument } = await import('@/lib/whatsapp-utils');

    // Calculer les totaux
    const totalHT = devis.lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT, 0);
    const tauxTVA = entreprise.tauxTVADefaut || 20;
    const totalTVA = totalHT * (tauxTVA / 100);
    const totalTTC = totalHT + totalTVA;

    const pdfBuffer = await genererDevisPDF({
      devis: {
        numero: devis.numero,
        date: devis.date,
        dateValidite: new Date(devis.date.getTime() + devis.validiteJours * 24 * 60 * 60 * 1000),
        lignes: devis.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
        })),
        totalHT,
        totalTTC,
        tauxTVA,
        conditionsPaiement: '30 jours net',
      },
      entreprise: {
        nom: entreprise.nom,
        adresse: entreprise.adresse,
        siren: entreprise.siren,
        tvaIntra: entreprise.tvaIntra,
        mentionTVALegale: entreprise.mentionTVALegale,
      },
      client: {
        nom: devis.client.nom,
        adresse: devis.client.adresse,
        siren: devis.client.siren,
        tvaIntra: devis.client.tvaIntra,
      },
    });

    const nomFichier = genererNomFichierDevis(devis.numero, devis.client.nom);
    const pdfUrl = await uploadPDFTemporary(pdfBuffer, nomFichier);

    await sendWhatsAppDocument(from, pdfUrl, nomFichier, `📄 Devis ${devis.numero}`);

    await sendWhatsAppText(
      from,
      `📄 *Devis ${devis.numero}*\n\n` +
      `• Client : ${devis.client.nom}\n` +
      `• Total TTC : ${totalTTC.toFixed(2)}€\n` +
      `• Statut : ${devis.statut?.toUpperCase() || 'BROUILLON'}\n\n` +
      `Tapez *menu* pour voir les options.`
    );
  } catch (error) {
    console.error('[Devis] Erreur lors de l\'impression:', error);
    
    const { notifierErreurSupport } = await import('@/lib/bot/utils/devis');
    await notifierErreurSupport(error instanceof Error ? error : String(error), {
      utilisateurId: user.id,
      telephone: from,
      etape: 'impression_devis',
      action: 'Génération PDF devis',
    });

    await sendWhatsAppText(
      from,
      `❌ Une erreur est survenue.\n\n` +
      `Nous corrigerons ce problème dans les plus brefs délais.\n` +
      `Veuillez réessayer dans quelques minutes.\n\n` +
      `Si le problème persiste, contactez le support :\n` +
      `📱 wa.me/22961916209`
    );
  }
}