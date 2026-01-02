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

  // Construire le message
  let message = '🧾 *CRÉATION DE FACTURE*\n\n';
  message += '*Comment souhaitez-vous créer votre facture ?*\n\n';

  if (devisDisponibles.length > 0) {
    message += '*1️⃣ À partir d\'un devis existant*\n';
    message += '_Transformez un devis accepté en facture_\n\n';
  }

  message += '*2️⃣ Nouvelle facture*\n';
  message += '_Créez une facture de zéro_\n\n';

  message += '*Tapez 1 ou 2 pour choisir*\n\n';
  message += '---\n';
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
    const { uploadPDFTemporary } = await import('@/lib/bot/utils/devis');
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

    const pdfUrl = await uploadPDFTemporary(pdfBuffer, `facture-${factureValidee.numero}.pdf`);

    console.log(`[Facture] PDF uploadé: ${pdfUrl}, envoi WhatsApp...`);

    await sendWhatsAppDocument(from, pdfUrl, `Facture_${factureValidee.numero}.pdf`, `📄 Votre facture ${factureValidee.numero}`);

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
    await sendWhatsAppText(
      from,
      `❌ Erreur lors de la génération du PDF.\n\n` +
      `La facture a été validée mais le PDF n'a pas pu être généré.\n` +
      `Veuillez réessayer ou contacter le support.\n\n` +
      `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
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
