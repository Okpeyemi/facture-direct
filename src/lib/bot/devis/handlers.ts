// src/lib/bot/devis/handlers.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';

import { sendWhatsAppDocument } from '@/lib/whatsapp-utils';
import { genererDevisPDF } from '@/lib/pdf-generator';
import { parseLignesSimple } from './parser';
import { genererNumeroDevis, uploadPDFTemporary } from '@/lib/bot/utils/devis';
import { normalizePhone } from '../utils/phone';
import { STEPS } from './constants';
import { DevisDraft } from './types';

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

export async function handleDevisStep(from: string, draft: DevisDraft, user: any, text: string) {
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