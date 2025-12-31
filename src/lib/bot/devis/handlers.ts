// src/lib/bot/devis/handlers.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';

const STEPS = {
  ASKING_LIGNES: 'asking_lignes',
  CREATING_CLIENT: 'creating_client',
};

export async function handleCreatingClient(from: string, phone: string, text: string, data: any, draft: any, user: any) {
  const entreprise = user.entreprise;
  const clientNom = data.clientNom;

  // Parser réponse (e.g., "OUI - Dupont SARL - 12 rue des Lilas")
  if (!text.toLowerCase().startsWith('oui')) {
    await sendWhatsAppText(from, 'Création annulée. Réessayez.');
    await prisma.devisDraft.delete({ where: { id: draft.id } });
    return;
  }

  const parts = text.replace(/^oui\s*-\s*/i, '').split(' - ');
  if (parts.length < 2) {
    await sendWhatsAppText(from, 'Format invalide. Répondez OUI + nom + adresse.');
    return;
  }

  const [nom, adresse] = parts;
  if (!nom.trim() || !adresse.trim()) {
    await sendWhatsAppText(from, 'Nom ou adresse manquant.');
    return;
  }

  // Créer client
  const client = await prisma.client.create({
    data: {
      entrepriseId: entreprise.id,
      nom: nom.trim(),
      adresse: adresse.trim(),
    },
  });

  // Mettre à jour draft et passer aux lignes
  await prisma.devisDraft.update({
    where: { id: draft.id },
    data: {
      step: STEPS.ASKING_LIGNES,
      data: { ...data, clientId: client.id },
    },
  });

  await sendWhatsAppText(from, `Client "${nom}" créé. Décrivez les lignes du devis.`);
}