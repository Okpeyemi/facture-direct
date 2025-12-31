// src/lib/bot/devis/index.ts

import { prisma } from '@/lib/prisma';
type DevisDraft = {
  id: string;
  status: string;
  titre: string | null;
  step: string | null;
  data: unknown;
  utilisateurId: string;
};
import { sendWhatsAppText, sendWhatsAppDocument } from '@/lib/whatsapp-utils';
import { genererDevisPDF } from '@/lib/pdf-generator';
import { parseLignesSimple } from './parser';
import { genererNumeroDevis, uploadPDFTemporary } from '@/lib/bot/utils/devis';
import { normalizePhone } from '../utils/phone';
import { parseDevisIntent, type ParsedDevisIntent } from './utils';
import { handleCreatingClient } from './handlers';

const STEPS = {
  ASKING_CLIENT: 'asking_client',
  CREATING_CLIENT: 'creating_client',
  ASKING_LIGNES: 'asking_lignes',
  ASKING_VALIDITE: 'asking_validite',
  ASKING_CONDITIONS: 'asking_conditions',
  CHOOSING_DRAFT: 'choosing_draft',
};

export async function handleDevisCreation(
  from: string,
  phone: string,
  user: any,
  text?: string,
  activeDraftId?: string
) {

  console.log('handleDevisCreation called with:', { from, phone, text, activeDraftId });
  const entreprise = user.entreprise;

  // Récupère tous les drafts actifs/paused
  const drafts = await prisma.devisDraft.findMany({
    where: {
      utilisateurId: user.id,
      status: { in: ['active', 'paused'] },
    },
    orderBy: { updatedAt: 'desc' },
  });

  
  // Analyse LLM si texte fourni et pas de draft actif spécifié
  let parsedIntent: ParsedDevisIntent | null = null;
  if (text && !activeDraftId && drafts.length === 0) {
    try {
      parsedIntent = await parseDevisIntent(text);
      if (parsedIntent.confidence < 0.7) {
        await sendWhatsAppText(from, 'Je n\'ai pas bien compris. Pouvez-vous préciser ? Par exemple : "Créé un devis pour [client]" ou "Reprends le devis [numéro]".');
        return;
      }
    } catch (error) {
      console.error('Erreur analyse LLM devis:', error);
      await sendWhatsAppText(from, 'Erreur technique. Réessayez.');
      return;
    }
  }

  // Si un draft est spécifié (reprise), on le prend
  let currentDraft = activeDraftId
    ? drafts.find((d: DevisDraft) => d.id === activeDraftId)
    : drafts.find((d: DevisDraft) => d.status === 'active') || drafts[0];

  // Gestion avec parsed si disponible
  if (parsedIntent && parsedIntent.clientName) {
    const client = await prisma.client.findFirst({
      where: {
        entrepriseId: entreprise.id,
        nom: { contains: parsedIntent.clientName, mode: 'insensitive' },
      },
    });

    if (!client) {
      // Demander création client
      await sendWhatsAppText(from, `Client "${parsedIntent.clientName}" non trouvé. Voulez-vous le créer ? Répondez OUI + nom + adresse (ex: "OUI - Dupont SARL - 12 rue des Lilas, 75020 Paris").`);
      currentDraft = await prisma.devisDraft.create({
        data: {
          utilisateurId: user.id,
          step: STEPS.CREATING_CLIENT,
          data: { clientNom: parsedIntent.clientName },
          status: 'active',
        },
      });
      return;
    }

    // Client existe : vérifier devis en cours
    const existingDraft = drafts.find((d: DevisDraft) => d.data && typeof d.data === 'object' && 'clientId' in d.data && (d.data as Record<string, unknown>).clientId === client.id && d.status === 'active');
    if (existingDraft) {
      await sendWhatsAppText(from, `Il y a déjà un devis en cours pour ${client.nom}. Voulez-vous le reprendre (R) ou en créer un nouveau (N) ?`);
      await prisma.devisDraft.update({
        where: { id: existingDraft.id },
        data: { step: STEPS.CHOOSING_DRAFT, data: { ...(existingDraft.data as object), newClient: parsedIntent.clientName } },
      });
      return;
    }

    // Pas de devis en cours : créer nouveau draft
    currentDraft = await prisma.devisDraft.create({
      data: {
        utilisateurId: user.id,
        step: STEPS.ASKING_LIGNES,
        data: { clientId: client.id },
        status: 'active',
      },
    });
    await sendWhatsAppText(from, `Devis pour ${client.nom} créé. Décrivez les lignes (ex: "10 heures consulting à 90€ HT").`);
    return;
  }

  // Gestion reprise si parsed.resumeDevisId
  if (parsedIntent && parsedIntent.resumeDevisId) {
    const devis = await prisma.devis.findUnique({
      where: { id: parsedIntent.resumeDevisId, entrepriseId: entreprise.id },
      include: { lignes: true },
    });
    if (!devis) {
      await sendWhatsAppText(from, 'Devis non trouvé. Créons-en un nouveau.');
      // Continuer sans reprise
    } else {
      // Reprendre : créer draft avec lignes copiées
      currentDraft = await prisma.devisDraft.create({
        data: {
          utilisateurId: user.id,
          step: STEPS.ASKING_LIGNES,
          data: { clientId: devis.clientId, lignes: devis.lignes },
          status: 'active',
        },
      });
      await sendWhatsAppText(from, `Reprise du devis ${parsedIntent.resumeDevisId}. Lignes copiées. Modifiez si besoin.`);
      return;
    }
  }

  // Si pas de parsed ou pas de client, demander
  if (!parsedIntent || !parsedIntent.clientName) {
    if (!currentDraft) {
      // Créer draft pour demander client
      currentDraft = await prisma.devisDraft.create({
        data: {
          utilisateurId: user.id,
          step: STEPS.ASKING_CLIENT,
          data: {},
          status: 'active',
        },
      });
      await sendWhatsAppText(from, 'Pour quel client ? (nom existant ou nouveau)');
      return;
    }
  }

  // Si pas de draft actif et pas de texte (premier appel), on propose le choix
  if (!currentDraft && drafts.length > 0 && !text) {
    let message = `Vous avez ${drafts.length} devis en cours :\n\n`;
    drafts.forEach((d: DevisDraft, i: number) => {
      const titre = d.titre || `Devis ${i + 1}`;
      const statut = d.status === 'paused' ? ' (en pause)' : '';
      message += `${i + 1}. ${titre}${statut}\n`;
    });
    message += `\nQue voulez-vous faire ?\n`;
    message += `• Répondez par le numéro pour reprendre\n`;
    message += `• "nouveau" pour créer un nouveau devis\n`;
    message += `• "annuler 2" pour supprimer le devis n°2\n`;
    message += `• "pause 1" pour mettre en pause le devis n°1`;

    await sendWhatsAppText(from, message);

    // Marque tous les drafts en mode choix
    await prisma.devisDraft.updateMany({
      where: { utilisateurId: user.id },
      data: { step: STEPS.CHOOSING_DRAFT },
    });
    return;
  }

  // Gestion du choix initial
  if (drafts.length > 0 && text && drafts[0].step === STEPS.CHOOSING_DRAFT) {
    const lower = text.toLowerCase().trim();

    if (lower === 'nouveau') {
      currentDraft = await prisma.devisDraft.create({
        data: {
          utilisateurId: user.id,
          titre: 'Nouveau devis',
          step: STEPS.ASKING_CLIENT,
          data: {},
        },
      });
      await sendWhatsAppText(from, `Nouveau devis créé !\n\nPour quel client ?`);
      return;
    }

    // Annuler un draft
    const cancelMatch = lower.match(/annuler\s+(\d+)/);
    if (cancelMatch) {
      const index = parseInt(cancelMatch[1]) - 1;
      if (drafts[index]) {
        await prisma.devisDraft.delete({ where: { id: drafts[index].id } });
        await sendWhatsAppText(from, `Devis "${drafts[index].titre || index + 1}" annulé.`);
        return await handleDevisCreation(from, phone, user);
      }
    }

    // Pause
    const pauseMatch = lower.match(/pause\s+(\d+)/);
    if (pauseMatch) {
      const index = parseInt(pauseMatch[1]) - 1;
      if (drafts[index]) {
        await prisma.devisDraft.update({
          where: { id: drafts[index].id },
          data: { status: 'paused' },
        });
        await sendWhatsAppText(from, `Devis "${drafts[index].titre || index + 1}" mis en pause.`);
        return await handleDevisCreation(from, phone, user);
      }
    }

    // Reprise par numéro
    const num = parseInt(text);
    if (!isNaN(num) && drafts[num - 1]) {
      currentDraft = drafts[num - 1];
      await prisma.devisDraft.update({
        where: { id: currentDraft.id },
        data: { status: 'active', step: currentDraft.step || STEPS.ASKING_CLIENT },
      });
      await sendWhatsAppText(from, `Reprise du devis "${currentDraft.titre || num}" !\nOù en étions-nous ?`);
      return await handleDevisStep(from, currentDraft, user, '');
    }
  }

  // Si aucun draft, on en crée un nouveau
  if (!currentDraft) {
    currentDraft = await prisma.devisDraft.create({
      data: {
        utilisateurId: user.id,
        titre: 'Nouveau devis',
        step: STEPS.ASKING_CLIENT,
        data: {},
      },
    });
    await sendWhatsAppText(from, `Nouveau devis créé !\n\nPour quel client ?`);
    return;
  }

  // Flux normal d'un draft actif
  await handleDevisStep(from, currentDraft, user, text || '');
}

// Fonction séparée pour la logique par étape
async function handleDevisStep(from: string, draft: any, user: any, text: string) {
  const entreprise = user.entreprise;
  const phone = normalizePhone(from);
  const lowerText = text.toLowerCase().trim();

  switch (draft.step) {
    case STEPS.ASKING_CLIENT: {
      const clientName = text.trim();
      if (!clientName) {
        await sendWhatsAppText(from, 'Nom de client invalide. Réessayez.');
        return;
      }

      const client = await prisma.client.findFirst({
        where: {
          entrepriseId: entreprise.id,
          nom: { contains: clientName, mode: 'insensitive' },
        },
      });

      if (!client) {
        // Demander création
        await sendWhatsAppText(from, `Client "${clientName}" non trouvé. Voulez-vous le créer ? Répondez OUI + nom + adresse (ex: "OUI - Dupont SARL - 12 rue des Lilas, 75020 Paris").`);
        await prisma.devisDraft.update({
          where: { id: draft.id },
          data: { step: STEPS.CREATING_CLIENT, data: { clientNom: clientName } },
        });
        return;
      }

      // Client existe : vérifier devis en cours
      const existingDraft = await prisma.devisDraft.findFirst({
        where: {
          utilisateurId: user.id,
          status: 'active',
          data: {
            path: ['clientId'],
            equals: client.id,
          },
        },
      });
      if (existingDraft) {
        await sendWhatsAppText(from, `Il y a déjà un devis en cours pour ${client.nom}. Voulez-vous le reprendre (R) ou en créer un nouveau (N) ?`);
        await prisma.devisDraft.update({
          where: { id: existingDraft.id },
          data: { step: STEPS.CHOOSING_DRAFT, data: { ...(existingDraft.data as object), newClient: clientName } },
        });
        return;
      }

      // Pas de devis en cours : passer aux lignes
      await prisma.devisDraft.update({
        where: { id: draft.id },
        data: { step: STEPS.ASKING_LIGNES, data: { clientId: client.id } },
      });
      await sendWhatsAppText(from, `Devis pour ${client.nom} créé. Décrivez les lignes (ex: "10 heures consulting à 90€ HT").`);
      break;
    }

    case STEPS.CREATING_CLIENT: {
      await handleCreatingClient(from, phone, text, draft.data, draft, user);
      break;
    }

    case STEPS.ASKING_LIGNES: {
      const lignes = parseLignesSimple(text);

      if (lignes.length === 0) {
        await sendWhatsAppText(from, `Je n'ai pas compris les lignes.\nExemple : "10 heures de consulting à 90€ HT"`);
        return;
      }

      const totalHT = lignes.reduce((sum: number, l: any) => sum + l.quantite * l.prixUnitaireHT, 0);

      await sendWhatsAppText(
        from,
        `Lignes ajoutées :\n${lignes.map((l: any) => `• ${l.quantite} × ${l.description} à ${l.prixUnitaireHT}€ HT`).join('\n')}\n\nTotal HT : ${totalHT.toFixed(2)}€\n\nDurée de validité ? (ex: 30 jours)`
      );

      await prisma.devisDraft.update({
        where: { id: draft.id },
        data: {
          step: STEPS.ASKING_VALIDITE,
          data: { ...draft.data, lignes, totalHT },
        },
      });
      break;
    }

    case STEPS.ASKING_VALIDITE: {
      const validiteJours = parseInt(text) || 30;

      await sendWhatsAppText(from, `Validité : ${validiteJours} jours\n\nConditions de paiement ? (ex: "30 jours net")`);

      await prisma.devisDraft.update({
        where: { id: draft.id },
        data: {
          step: STEPS.ASKING_CONDITIONS,
          data: { ...draft.data, validiteJours },
        },
      });
      break;
    }

    case STEPS.ASKING_CONDITIONS: {
      const conditions = text.trim() || '30 jours net';

      const client = await prisma.client.findUnique({ where: { id: draft.data.clientId } });
      if (!client) throw new Error('Client introuvable');

      const numero = await genererNumeroDevis(entreprise.id);

      const devis = await prisma.devis.create({
        data: {
          numero,
          date: new Date(),
          validiteJours: draft.data.validiteJours,
          statut: 'brouillon',
          clientId: client.id,
          entrepriseId: entreprise.id,
          lignes: {
            create: draft.data.lignes.map((l: any) => ({
              description: l.description,
              quantite: l.quantite,
              prixUnitaireHT: l.prixUnitaireHT,
              tauxTVA: entreprise.tauxTVADefaut || 20,
            })),
          },
        },
      });

      const pdfBuffer = await genererDevisPDF({
        devis: {
          numero,
          date: new Date(),
          dateValidite: new Date(Date.now() + draft.data.validiteJours * 24 * 60 * 60 * 1000),
          lignes: draft.data.lignes,
          totalHT: draft.data.totalHT,
          totalTTC: draft.data.totalHT * (1 + (entreprise.tauxTVADefaut || 20) / 100),
          tauxTVA: entreprise.tauxTVADefaut || 20,
          conditionsPaiement: conditions,
        },
        entreprise,
        client,
      });

      const pdfUrl = await uploadPDFTemporary(pdfBuffer, `devis-${numero}.pdf`);

      await sendWhatsAppDocument(from, pdfUrl, `Devis_${numero}.pdf`, `Voici votre devis ${numero} !`);

      await sendWhatsAppText(from, `Devis ${numero} créé et envoyé !\nSouhaitez-vous le transformer en facture maintenant ? (OUI/NON)`);

      await prisma.devisDraft.delete({ where: { id: draft.id } });
      break;
    }

    default:
      await sendWhatsAppText(from, `État inconnu. Recommençons un nouveau devis ?`);
      await prisma.devisDraft.delete({ where: { id: draft.id } });
      break;
  }
}