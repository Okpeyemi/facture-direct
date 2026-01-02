// src/lib/bot/facture/handlers.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText, sendWhatsAppDocument } from '@/lib/whatsapp-utils';
import { genererFacturePDF } from '@/lib/pdf-generator';
import { parseLignesSimple } from '../devis/parser';
import { genererNumeroFacture } from './index';
import { FACTURE_STEPS } from './constants';
import { FactureDraftData } from './types';

export async function handleFactureStep(from: string, draft: any, user: any, text: string) {
  const entreprise = user.entreprise;
  const lowerText = text.toLowerCase().trim();
  const data = (draft.data || {}) as FactureDraftData;

  switch (draft.step) {
    // La sélection du devis se fait directement à l'étape CHOOSING_SOURCE
    case FACTURE_STEPS.CHOOSING_SOURCE:
    case FACTURE_STEPS.SELECTING_DEVIS: {
      const num = parseInt(lowerText);
      const devisList = data.devisList || [];

      if (isNaN(num) || num < 1 || num > devisList.length) {
        await sendWhatsAppText(from, `⚠️ Veuillez taper un numéro entre 1 et ${devisList.length}.`);
        return;
      }

      const selectedDevis = devisList[num - 1];
      
      // Récupérer le devis complet avec ses lignes
      const devis = await prisma.devis.findUnique({
        where: { id: selectedDevis.id },
        include: { client: true, lignes: true },
      });

      if (!devis) {
        await sendWhatsAppText(from, '❌ Devis introuvable. Réessayez.');
        return;
      }

      // Calculer les totaux
      const lignes = devis.lignes.map(l => ({
        description: l.description,
        quantite: l.quantite,
        prixUnitaireHT: l.prixUnitaireHT,
        tauxTVA: l.tauxTVA,
      }));

      const totalHT = lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT, 0);
      const totalTVA = lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT * (l.tauxTVA / 100), 0);
      const totalTTC = totalHT + totalTVA;

      // Passer aux conditions de paiement
      await prisma.factureDraft.update({
        where: { id: draft.id },
        data: {
          step: FACTURE_STEPS.ASKING_CONDITIONS,
          data: {
            ...data,
            source: 'devis',
            devisId: devis.id,
            clientId: devis.clientId,
            clientNom: devis.client.nom,
            lignes,
            totalHT,
            totalTVA,
            totalTTC,
          },
        },
      });

      let message = `✅ Devis *${devis.numero}* sélectionné\n`;
      message += `📦 Client : *${devis.client.nom}*\n\n`;
      message += `*Lignes :*\n`;
      lignes.forEach(l => {
        message += `• ${l.quantite} × ${l.description} à ${l.prixUnitaireHT}€ HT\n`;
      });
      message += `\n💰 *Total HT : ${totalHT.toFixed(2)}€*\n`;
      message += `💰 *TVA : ${totalTVA.toFixed(2)}€*\n`;
      message += `💰 *Total TTC : ${totalTTC.toFixed(2)}€*\n\n`;
      message += `📋 *ÉTAPE 2/3 : Conditions de paiement*\n\n`;
      message += `💳 Quelles sont les conditions de paiement ?\n\n`;
      message += `_Exemples :_\n`;
      message += `• "30 jours net"\n`;
      message += `• "À réception"\n\n`;
      message += `💡 Tapez *ok* pour "30 jours net" par défaut.\n\n`;
      message += `---\n`;
      message += `💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._`;

      await sendWhatsAppText(from, message);
      break;
    }

    case FACTURE_STEPS.ASKING_CLIENT: {
      const clientsList = data.clientsList || [];

      // Option 0 = nouveau client
      if (lowerText === '0') {
        await prisma.factureDraft.update({
          where: { id: draft.id },
          data: { step: FACTURE_STEPS.ASKING_NEW_CLIENT_NAME },
        });
        await sendWhatsAppText(
          from,
          '📋 *ÉTAPE 1/3 : Nouveau client*\n\n' +
          '👤 Quel est le *nom* du client ?\n\n' +
          '_Exemple : "Dupont SARL" ou "Marie Martin"_\n\n' +
          '---\n' +
          '💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._'
        );
        return;
      }

      // Sélection par numéro
      const num = parseInt(lowerText);
      if (!isNaN(num) && num >= 1 && num <= clientsList.length) {
        const selectedClient = clientsList[num - 1];
        const client = await prisma.client.findUnique({ where: { id: selectedClient.id } });

        if (!client) {
          await sendWhatsAppText(from, '⚠️ Client introuvable. Tapez *0* pour créer un nouveau client.');
          return;
        }

        // Passer aux lignes
        await prisma.factureDraft.update({
          where: { id: draft.id },
          data: {
            step: FACTURE_STEPS.ASKING_LIGNES,
            data: { ...data, clientId: client.id, clientNom: client.nom } as any,
          },
        });

        await sendWhatsAppText(
          from,
          `✅ Client sélectionné : *${client.nom}*\n\n` +
          `📋 *ÉTAPE 2/3 : Lignes de la facture*\n\n` +
          `Décrivez ce que vous facturez.\n\n` +
          `_Exemples :_\n` +
          `• "10 heures consulting à 90€"\n` +
          `• "1 site web 2500€"\n` +
          `• "5 jours formation à 600€/jour"\n\n` +
          `---\n` +
          `💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._`
        );
        return;
      }

      // Réponse non reconnue
      let message = '⚠️ Je n\'ai pas compris votre choix.\n\n';
      if (clientsList.length > 0) {
        message += `Tapez un numéro entre *1* et *${clientsList.length}* pour sélectionner un client,\n`;
      }
      message += 'ou tapez *0* pour créer un nouveau client.';
      await sendWhatsAppText(from, message);
      break;
    }

    case FACTURE_STEPS.ASKING_NEW_CLIENT_NAME: {
      const clientName = text.trim();

      if (!clientName || clientName.length < 2) {
        await sendWhatsAppText(from, '⚠️ Nom invalide. Veuillez entrer un nom de client valide.');
        return;
      }

      await prisma.factureDraft.update({
        where: { id: draft.id },
        data: {
          step: FACTURE_STEPS.ASKING_NEW_CLIENT_ADDRESS,
          data: { ...data, clientNom: clientName } as any,
        },
      });

      await sendWhatsAppText(
        from,
        `✅ Nom : *${clientName}*\n\n` +
        `📋 *ÉTAPE 1/3 : Adresse du client*\n\n` +
        `📍 Quelle est l'*adresse* du client ?\n\n` +
        `_Exemple : "12 rue des Lilas, 75020 Paris"_\n\n` +
        `💡 Tapez *ok* si vous ne souhaitez pas renseigner d'adresse.\n\n` +
        `---\n` +
        `💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._`
      );
      break;
    }

    case FACTURE_STEPS.ASKING_NEW_CLIENT_ADDRESS: {
      const address = (lowerText === 'ok' || lowerText === '-' || lowerText === '') ? null : text.trim();

      // Créer le client
      const client = await prisma.client.create({
        data: {
          entrepriseId: entreprise.id,
          nom: data.clientNom!,
          adresse: address,
        },
      });

      // Passer aux lignes
      await prisma.factureDraft.update({
        where: { id: draft.id },
        data: {
          step: FACTURE_STEPS.ASKING_LIGNES,
          data: { ...data, clientId: client.id, clientNom: client.nom } as any,
        },
      });

      await sendWhatsAppText(
        from,
        `✅ Client "*${client.nom}*" créé !\n\n` +
        `📋 *ÉTAPE 2/3 : Lignes de la facture*\n\n` +
        `Décrivez ce que vous facturez.\n\n` +
        `_Exemples :_\n` +
        `• "10 heures consulting à 90€"\n` +
        `• "1 site web 2500€"\n` +
        `• "5 jours formation à 600€/jour"\n\n` +
        `---\n` +
        `💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._`
      );
      break;
    }

    case FACTURE_STEPS.ASKING_LIGNES: {
      const lignes = parseLignesSimple(text);

      if (lignes.length === 0) {
        await sendWhatsAppText(
          from,
          `⚠️ Je n'ai pas compris les lignes.\n\n` +
          `_Exemples de formats acceptés :_\n` +
          `• "10 heures consulting à 90€"\n` +
          `• "1 site web 2500€"\n` +
          `• "5 jours formation 600€/jour"\n\n` +
          `Réessayez en décrivant vos prestations.`
        );
        return;
      }

      // Ajouter le taux TVA par défaut
      const lignesAvecTVA = lignes.map(l => ({
        ...l,
        tauxTVA: entreprise.tauxTVADefaut || 20,
      }));

      const totalHT = lignesAvecTVA.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT, 0);
      const totalTVA = lignesAvecTVA.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT * (l.tauxTVA / 100), 0);
      const totalTTC = totalHT + totalTVA;

      await prisma.factureDraft.update({
        where: { id: draft.id },
        data: {
          step: FACTURE_STEPS.ASKING_CONDITIONS,
          data: { ...data, lignes: lignesAvecTVA, totalHT, totalTVA, totalTTC } as any,
        },
      });

      await sendWhatsAppText(
        from,
        `✅ *Lignes ajoutées :*\n` +
        `${lignesAvecTVA.map(l => `• ${l.quantite} × ${l.description} à ${l.prixUnitaireHT}€ HT`).join('\n')}\n\n` +
        `💰 *Total HT : ${totalHT.toFixed(2)}€*\n` +
        `💰 *TVA (${entreprise.tauxTVADefaut || 20}%) : ${totalTVA.toFixed(2)}€*\n` +
        `💰 *Total TTC : ${totalTTC.toFixed(2)}€*\n\n` +
        `📋 *ÉTAPE 3/3 : Conditions de paiement*\n\n` +
        `💳 Quelles sont les conditions de paiement ?\n\n` +
        `_Exemples :_\n` +
        `• "30 jours net"\n` +
        `• "À réception"\n\n` +
        `💡 Tapez *ok* pour "30 jours net" par défaut.\n\n` +
        `---\n` +
        `💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._`
      );
      break;
    }

    case FACTURE_STEPS.ASKING_CONDITIONS: {
      const conditions = (lowerText === 'ok' || lowerText === '') ? '30 jours net' : text.trim();

      // Récupérer le client
      const client = await prisma.client.findUnique({ where: { id: data.clientId } });
      if (!client) {
        await sendWhatsAppText(from, '❌ Erreur : client introuvable.');
        await prisma.factureDraft.delete({ where: { id: draft.id } });
        return;
      }

      await sendWhatsAppText(from, '⏳ Création de la facture en cours...');

      // Générer le numéro de facture
      const numero = await genererNumeroFacture(entreprise.id);

      // Créer la facture en brouillon
      const facture = await prisma.facture.create({
        data: {
          numero,
          type: 'STANDARD',
          statut: 'BROUILLON',
          dateCreation: new Date(),
          clientId: client.id,
          entrepriseId: entreprise.id,
          creeParId: user.id,
          totalHT: data.totalHT || 0,
          totalTVA: data.totalTVA || 0,
          totalTTC: data.totalTTC || 0,
          devisId: data.devisId || null,
          lignes: {
            create: (data.lignes || []).map(l => ({
              description: l.description,
              quantite: l.quantite,
              prixUnitaireHT: l.prixUnitaireHT,
              tauxTVA: l.tauxTVA,
            })),
          },
        },
      });

      // Mettre à jour le statut du devis si applicable
      if (data.devisId) {
        await prisma.devis.update({
          where: { id: data.devisId },
          data: { statut: 'accepté' },
        });
      }

      // Supprimer le draft
      await prisma.factureDraft.delete({ where: { id: draft.id } });

      // Message de confirmation avec option de validation
      await sendWhatsAppText(
        from,
        `🎉 *Facture ${numero} créée !*\n\n` +
        `📊 *Récapitulatif :*\n` +
        `• Client : ${client.nom}\n` +
        `• Total HT : ${(data.totalHT || 0).toFixed(2)}€\n` +
        `• TVA : ${(data.totalTVA || 0).toFixed(2)}€\n` +
        `• Total TTC : ${(data.totalTTC || 0).toFixed(2)}€\n` +
        `• Conditions : ${conditions}\n\n` +
        `⚠️ *La facture est en BROUILLON*\n\n` +
        `Que souhaitez-vous faire ?\n` +
        `• Tapez *valider* pour valider définitivement\n` +
        `• Tapez *modifier* pour modifier les lignes\n` +
        `• Tapez *imprimer* pour générer le PDF\n` +
        `• Tapez *menu* pour revenir au menu\n\n` +
        `_Une facture validée est définitive et ne peut plus être modifiée._`
      );
      break;
    }

    default:
      await sendWhatsAppText(from, '❌ État inconnu. Tapez *menu* pour revenir au menu.');
      await prisma.factureDraft.delete({ where: { id: draft.id } });
      break;
  }
}
