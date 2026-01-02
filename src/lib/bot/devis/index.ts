// src/lib/bot/devis/index.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';
import { handleDevisStep } from './handlers';
import { STEPS } from './constants';

/**
 * Gère les réponses utilisateur dans le flux de création de devis.
 * Appelé quand un draft actif existe et que le message n'est pas une commande de réinitialisation.
 */
export async function handleDevisFlowResponse(
  from: string,
  phone: string,
  user: any,
  text: string,
  draft: any
) {
  console.log(`[Devis] Traitement réponse flux: step=${draft.step}, text="${text}"`);
  await handleDevisStep(from, draft, user, text);
}

/**
 * Démarre un nouveau flux de création de devis.
 * Les anciens drafts sont supprimés avant l'appel (dans handleIncomingMessage).
 */
export async function handleDevisCreation(
  from: string,
  phone: string,
  user: any
) {
  console.log('[Devis] Démarrage nouveau devis pour', phone);
  const entreprise = user.entreprise;

  // Récupérer les clients existants
  const clients = await prisma.client.findMany({
    where: { entrepriseId: entreprise.id },
    orderBy: { nom: 'asc' },
    take: 10,
  });

  // Créer un nouveau draft
  await prisma.devisDraft.create({
    data: {
      utilisateurId: user.id,
      step: STEPS.ASKING_CLIENT,
      data: { clientsList: clients.map(c => ({ id: c.id, nom: c.nom })) },
      status: 'active',
    },
  });

  // Construire le message avec liste des clients
  let message = '📋 *ÉTAPE 1/4 : Sélection du client*\n\n';
  
  if (clients.length > 0) {
    message += '*Vos clients existants :*\n';
    clients.forEach((c, i) => {
      message += `${i + 1}. ${c.nom}\n`;
    });
    message += '\n';
  }
  
  message += '*Options :*\n';
  if (clients.length > 0) {
    message += '• Tapez le *numéro* (ex: 1) pour sélectionner un client\n';
  }
  message += '• Tapez *0* pour créer un nouveau client\n\n';
  message += '---\n';
  message += '💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._';

  await sendWhatsAppText(from, message);
}