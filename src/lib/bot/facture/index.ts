// src/lib/bot/facture/index.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';
import { handleFactureStep } from './handlers';
import { FACTURE_STEPS } from './constants';

/**
 * Gère les réponses utilisateur dans le flux de création de facture.
 */
export async function handleFactureFlowResponse(
  from: string,
  phone: string,
  user: any,
  text: string,
  draft: any
) {
  console.log(`[Facture] Traitement réponse flux: step=${draft.step}, text="${text}"`);
  await handleFactureStep(from, draft, user, text);
}

/**
 * Démarre un nouveau flux de création de facture.
 */
export async function handleFactureCreation(
  from: string,
  phone: string,
  user: any
) {
  console.log('[Facture] Démarrage nouvelle facture pour', phone);
  const entreprise = user.entreprise;

  // Récupérer les devis qui peuvent être transformés en facture
  const devisDisponibles = await prisma.devis.findMany({
    where: {
      entrepriseId: entreprise.id,
      statut: { in: ['brouillon', 'envoyé', 'accepté'] },
      facture: null, // Pas encore de facture associée
    },
    include: { client: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // Créer un nouveau draft
  await prisma.factureDraft.create({
    data: {
      utilisateurId: user.id,
      step: FACTURE_STEPS.CHOOSING_SOURCE,
      data: {
        devisList: devisDisponibles.map(d => ({
          id: d.id,
          numero: d.numero,
          clientNom: d.client.nom,
          totalTTC: 0, // Sera calculé à la sélection
        })),
      } as any,
      status: 'active',
    },
  });

  // Les factures ne peuvent être créées qu'à partir de devis
  if (devisDisponibles.length === 0) {
    // Supprimer le draft créé
    await prisma.factureDraft.deleteMany({
      where: { utilisateurId: user.id, status: 'active' },
    });

    await sendWhatsAppText(
      from,
      `🧾 *CRÉATION DE FACTURE*\n\n` +
      `⚠️ *Aucun devis disponible*\n\n` +
      `Pour créer une facture, vous devez d'abord avoir un devis.\n\n` +
      `Les factures sont générées à partir des devis validés.\n\n` +
      `*Que souhaitez-vous faire ?*\n` +
      `• Tapez *Créer un devis* pour commencer\n` +
      `• Tapez *menu* pour voir les options`
    );
    return;
  }

  // Construire le message avec la liste des devis
  let message = '🧾 *CRÉATION DE FACTURE*\n\n';
  message += '*Sélectionnez un devis à transformer en facture :*\n\n';

  devisDisponibles.forEach((d, i) => {
    const statutIcon = d.statut === 'accepté' ? '✅' : d.statut === 'envoyé' ? '📤' : '📋';
    message += `*${i + 1}.* ${statutIcon} ${d.numero}\n`;
    message += `   👤 ${d.client.nom}\n\n`;
  });

  message += '---\n';
  message += '*Tapez le numéro du devis* (ex: 1)\n\n';
  message += '💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._';

  await sendWhatsAppText(from, message);
}

/**
 * Valide la dernière facture en brouillon de l'utilisateur.
 * Une fois validée, la facture est définitive et le PDF est généré.
 */
export async function handleValidateFacture(from: string, user: any) {
  const entreprise = user.entreprise;

  // Trouver la dernière facture brouillon
  const facture = await prisma.facture.findFirst({
    where: {
      entrepriseId: entreprise.id,
      statut: 'BROUILLON',
    },
    include: { client: true, lignes: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!facture) {
    await sendWhatsAppText(from, '⚠️ Aucune facture brouillon à valider.\n\nCréez d\'abord une facture avec "Créer une facture".');
    return;
  }

  await sendWhatsAppText(from, '⏳ Validation de la facture en cours...');

  try {
    // Valider la facture
    const factureValidee = await prisma.facture.update({
      where: { id: facture.id },
      data: {
        statut: 'VALIDEE',
        dateEmission: new Date(),
        valideeParId: user.id,
        valideeLe: new Date(),
      },
      include: { client: true, lignes: true },
    });

    console.log(`[Facture] Facture ${factureValidee.numero} validée, génération du PDF...`);

    // Générer le PDF
    const { genererFacturePDF } = await import('@/lib/pdf-generator');
    const { uploadPDFTemporary, deletePDF, genererNomFichierFacture } = await import('@/lib/bot/utils/devis');
    const { sendWhatsAppDocument } = await import('@/lib/whatsapp-utils');

    const pdfBuffer = await genererFacturePDF({
      facture: {
        numero: factureValidee.numero,
        dateEmission: factureValidee.dateEmission || new Date(),
        estValidee: true,
        lignes: factureValidee.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
          tauxTVA: l.tauxTVA,
        })),
        totalHT: factureValidee.totalHT,
        totalTVA: factureValidee.totalTVA,
        totalTTC: factureValidee.totalTTC,
        tauxTVA: entreprise.tauxTVADefaut || 20,
        conditionsPaiement: '30 jours net',
      },
      entreprise: {
        nom: entreprise.nom,
        adresse: entreprise.adresse,
        codePostal: entreprise.codePostal,
        ville: entreprise.ville,
        siren: entreprise.siren,
        tvaIntra: entreprise.tvaIntra,
        iban: entreprise.iban,
        bic: entreprise.bic,
        regimeTVA: entreprise.regimeTVA,
        mentionTVALegale: entreprise.mentionTVALegale,
        mentionsLegales: entreprise.mentionsLegales,
      },
      client: {
        nom: factureValidee.client.nom,
        adresse: factureValidee.client.adresse,
        siren: factureValidee.client.siren,
        tvaIntra: factureValidee.client.tvaIntra,
      },
    });

    console.log(`[Facture] PDF généré (${pdfBuffer.length} bytes), upload...`);

    // Supprimer l'ancien brouillon PDF s'il existe
    const nomBrouillon = genererNomFichierFacture(factureValidee.numero, factureValidee.client.nom, true);
    await deletePDF(`https://*.blob.vercel-storage.com/${nomBrouillon}`).catch(() => {});

    // Upload la version définitive
    const nomDefinitif = genererNomFichierFacture(factureValidee.numero, factureValidee.client.nom, false);
    const pdfUrl = await uploadPDFTemporary(pdfBuffer, nomDefinitif);

    console.log(`[Facture] PDF uploadé: ${pdfUrl}, envoi WhatsApp...`);

    await sendWhatsAppDocument(from, pdfUrl, nomDefinitif, `📄 Votre facture ${factureValidee.numero}`);

    await sendWhatsAppText(
      from,
      `✅ *Facture ${factureValidee.numero} VALIDÉE !*\n\n` +
      `📊 *Récapitulatif :*\n` +
      `• Client : ${factureValidee.client.nom}\n` +
      `• Total TTC : ${factureValidee.totalTTC.toFixed(2)}€\n` +
      `• Date d'émission : ${new Date().toLocaleDateString('fr-FR')}\n\n` +
      `⚠️ _Cette facture est maintenant définitive et ne peut plus être modifiée._\n\n` +
      `Que souhaitez-vous faire ?\n` +
      `• Tapez *menu* pour voir les options`
    );
  } catch (error) {
    console.error('[Facture] Erreur lors de la validation:', error);
    
    // Notifier le support en arrière-plan
    const { notifierErreurSupport } = await import('@/lib/bot/utils/devis');
    await notifierErreurSupport(error instanceof Error ? error : String(error), {
      utilisateurId: user.id,
      telephone: from,
      etape: 'validation_facture',
      action: 'Validation et génération PDF facture',
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

/**
 * Génère un numéro de facture unique et séquentiel.
 * Format: FACT-YYYY-XXXX (ex: FACT-2025-0001)
 */
export async function genererNumeroFacture(entrepriseId: string): Promise<string> {
  const annee = new Date().getFullYear();
  const prefix = `FACT-${annee}-`;

  // Trouver le dernier numéro de facture de l'année
  const derniereFacture = await prisma.facture.findFirst({
    where: {
      entrepriseId,
      numero: { startsWith: prefix },
    },
    orderBy: { numero: 'desc' },
  });

  let sequence = 1;
  if (derniereFacture) {
    const match = derniereFacture.numero.match(/FACT-\d{4}-(\d+)/);
    if (match) {
      sequence = parseInt(match[1]) + 1;
    }
  }

  return `${prefix}${sequence.toString().padStart(4, '0')}`;
}

/**
 * Permet de modifier une facture en brouillon.
 * Supprime la facture et relance le flux de création avec les mêmes données.
 */
export async function handleModifyFacture(from: string, user: any) {
  const entreprise = user.entreprise;

  // Trouver la dernière facture brouillon
  const facture = await prisma.facture.findFirst({
    where: {
      entrepriseId: entreprise.id,
      statut: 'BROUILLON',
    },
    include: { client: true, lignes: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!facture) {
    await sendWhatsAppText(from, '⚠️ Aucune facture brouillon à modifier.\n\nSeules les factures en brouillon peuvent être modifiées.');
    return;
  }

  // Supprimer la facture brouillon et ses lignes
  await prisma.ligneFacture.deleteMany({ where: { factureId: facture.id } });
  await prisma.facture.delete({ where: { id: facture.id } });

  // Créer un draft avec les données existantes pour modification
  await prisma.factureDraft.create({
    data: {
      utilisateurId: user.id,
      step: FACTURE_STEPS.ASKING_LIGNES,
      data: {
        source: 'nouvelle',
        clientId: facture.clientId,
        clientNom: facture.client.nom,
      } as any,
      status: 'active',
    },
  });

  await sendWhatsAppText(
    from,
    `✏️ *MODIFICATION DE FACTURE*\n\n` +
    `📋 Client : *${facture.client.nom}*\n\n` +
    `La facture ${facture.numero} a été annulée.\n` +
    `Vous pouvez maintenant saisir de nouvelles lignes.\n\n` +
    `📋 *Lignes de la facture*\n\n` +
    `Décrivez ce que vous facturez.\n\n` +
    `_Exemples :_\n` +
    `• "10 heures consulting à 90€"\n` +
    `• "1 site web 2500€"\n\n` +
    `---\n` +
    `💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._`
  );
}

/**
 * Génère et envoie le PDF d'une facture (brouillon ou validée).
 */
export async function handlePrintFacture(from: string, user: any) {
  const entreprise = user.entreprise;

  // Trouver la dernière facture (brouillon ou validée)
  const facture = await prisma.facture.findFirst({
    where: { entrepriseId: entreprise.id },
    include: { client: true, lignes: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!facture) {
    await sendWhatsAppText(from, '⚠️ Aucune facture à imprimer.\n\nCréez d\'abord une facture avec "Créer une facture".');
    return;
  }

  await sendWhatsAppText(from, `⏳ Génération du PDF de la facture ${facture.numero}...`);

  try {
    const { genererFacturePDF } = await import('@/lib/pdf-generator');
    const { uploadPDFTemporary, genererNomFichierFacture } = await import('@/lib/bot/utils/devis');
    const { sendWhatsAppDocument } = await import('@/lib/whatsapp-utils');

    const estBrouillon = facture.statut === 'BROUILLON';

    const pdfBuffer = await genererFacturePDF({
      facture: {
        numero: facture.numero,
        dateEmission: facture.dateEmission || new Date(),
        estValidee: !estBrouillon,
        lignes: facture.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
          tauxTVA: l.tauxTVA,
        })),
        totalHT: facture.totalHT,
        totalTVA: facture.totalTVA,
        totalTTC: facture.totalTTC,
        tauxTVA: entreprise.tauxTVADefaut || 20,
        conditionsPaiement: '30 jours net',
      },
      entreprise: {
        nom: entreprise.nom,
        adresse: entreprise.adresse,
        codePostal: entreprise.codePostal,
        ville: entreprise.ville,
        siren: entreprise.siren,
        tvaIntra: entreprise.tvaIntra,
        iban: entreprise.iban,
        bic: entreprise.bic,
        regimeTVA: entreprise.regimeTVA,
        mentionTVALegale: entreprise.mentionTVALegale,
        mentionsLegales: entreprise.mentionsLegales,
      },
      client: {
        nom: facture.client.nom,
        adresse: facture.client.adresse,
        siren: facture.client.siren,
        tvaIntra: facture.client.tvaIntra,
      },
    });

    // Utiliser la nomenclature correcte
    const nomFichier = genererNomFichierFacture(facture.numero, facture.client.nom, estBrouillon);
    const pdfUrl = await uploadPDFTemporary(pdfBuffer, nomFichier);

    await sendWhatsAppDocument(from, pdfUrl, nomFichier, `📄 Facture ${facture.numero}`);

    const statutText = estBrouillon ? '⚠️ BROUILLON' : '✅ VALIDÉE';
    await sendWhatsAppText(
      from,
      `📄 *Facture ${facture.numero}*\n\n` +
      `• Client : ${facture.client.nom}\n` +
      `• Total TTC : ${facture.totalTTC.toFixed(2)}€\n` +
      `• Statut : ${statutText}\n\n` +
      `Que souhaitez-vous faire ?\n` +
      `• Tapez *menu* pour voir les options`
    );
  } catch (error) {
    console.error('[Facture] Erreur lors de l\'impression:', error);
    
    // Notifier le support
    const { notifierErreurSupport } = await import('@/lib/bot/utils/devis');
    await notifierErreurSupport(error instanceof Error ? error : String(error), {
      utilisateurId: user.id,
      telephone: from,
      etape: 'impression_facture',
      action: 'Génération PDF facture',
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
