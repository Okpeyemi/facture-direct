// src/lib/bot/devis/index.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';
import { parseDevisIntent, type ParsedDevisIntent } from './utils';
import { handleDevisStep } from './handlers';
import { STEPS } from './constants';
import { DevisDraft } from './types';

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