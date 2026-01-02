// src/lib/bot/devis/handlers.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';

import { sendWhatsAppDocument } from '@/lib/whatsapp-utils';
import { genererDevisPDF } from '@/lib/pdf-generator';
import { parseLignesSimple } from './parser';
import { genererNumeroDevis, uploadPDFTemporary, genererNomFichierDevis } from '@/lib/bot/utils/devis';
import { normalizePhone } from '../utils/phone';
import { STEPS } from './constants';
import { DevisDraft } from './types';

export async function handleCreatingClient(from: string, phone: string, text: string, data: any, draft: any, user: any) {
  const entreprise = user.entreprise;
  const input = text.toLowerCase().trim();

  // Cas 1: Confirmation d'utilisation d'un client existant (nouveau flux)
  if (data.existingClientId) {
    if (input === 'oui' || input === 'o') {
      // Utiliser le client existant
      await prisma.devisDraft.update({
        where: { id: draft.id },
        data: { 
          step: STEPS.ASKING_LIGNES, 
          data: { clientId: data.existingClientId, clientNom: data.clientNom } 
        },
      });
      await sendWhatsAppText(
        from,
        `✅ Client sélectionné : *${data.clientNom}*\n\n` +
        `📋 *ÉTAPE 2/4 : Lignes du devis*\n\n` +
        `Décrivez ce que vous facturez.\n\n` +
        `_Exemples :_\n` +
        `• "10 heures consulting à 90€"\n` +
        `• "1 site web 2500€"\n` +
        `• "5 jours formation à 600€/jour"`
      );
      return;
    } else if (input === 'non' || input === 'n') {
      // Retourner à la saisie du nom
      await prisma.devisDraft.update({
        where: { id: draft.id },
        data: { step: STEPS.ASKING_NEW_CLIENT_NAME, data: {} },
      });
      await sendWhatsAppText(from, '📋 *ÉTAPE 1/4 : Nouveau client*\n\n👤 Quel est le *nom* du client ?\n\n_Exemple : "Dupont SARL" ou "Marie Martin"_');
      return;
    } else {
      await sendWhatsAppText(from, '⚠️ Répondez *OUI* pour utiliser ce client ou *NON* pour entrer un autre nom.');
      return;
    }
  }

  // Cas 2: Ancien flux (legacy) - Format "OUI - nom - adresse"
  if (!input.startsWith('oui')) {
    await sendWhatsAppText(from, '❌ Création annulée. Dites "Créer un devis" pour recommencer.');
    await prisma.devisDraft.delete({ where: { id: draft.id } });
    return;
  }

  const parts = text.replace(/^oui\s*-\s*/i, '').split(' - ');
  if (parts.length < 2) {
    await sendWhatsAppText(from, '⚠️ Format invalide. Répondez : OUI - Nom - Adresse\n_Exemple : "OUI - Dupont SARL - 12 rue des Lilas"_');
    return;
  }

  const [nom, adresse] = parts;
  if (!nom.trim() || !adresse.trim()) {
    await sendWhatsAppText(from, '⚠️ Nom ou adresse manquant.');
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

  // Passer aux lignes
  await prisma.devisDraft.update({
    where: { id: draft.id },
    data: {
      step: STEPS.ASKING_LIGNES,
      data: { ...data, clientId: client.id, clientNom: client.nom },
    },
  });

  await sendWhatsAppText(
    from,
    `✅ Client "*${nom.trim()}*" créé !\n\n` +
    `📋 *ÉTAPE 2/4 : Lignes du devis*\n\n` +
    `Décrivez ce que vous facturez.\n\n` +
    `_Exemples :_\n` +
    `• "10 heures consulting à 90€"\n` +
    `• "1 site web 2500€"\n` +
    `• "5 jours formation à 600€/jour"`
  );
}

export async function handleDevisStep(from: string, draft: DevisDraft, user: any, text: string) {
  const entreprise = user.entreprise;
  const phone = normalizePhone(from);
  const lowerText = text.toLowerCase().trim();

  switch (draft.step) {
    case STEPS.ASKING_CLIENT: {
      const input = text.trim().toLowerCase();
      const data = (draft.data || {}) as { clientsList?: { id: string; nom: string }[] };
      const clientsList = data.clientsList || [];

      // Annulation
      if (input === 'annuler') {
        await prisma.devisDraft.delete({ where: { id: draft.id } });
        await sendWhatsAppText(from, '❌ Création de devis annulée.');
        return;
      }

      // Option 0 = nouveau client
      if (input === '0') {
        await prisma.devisDraft.update({
          where: { id: draft.id },
          data: { step: STEPS.ASKING_NEW_CLIENT_NAME, data: {} },
        });
        await sendWhatsAppText(from, '📋 *ÉTAPE 1/4 : Nouveau client*\n\n👤 Quel est le *nom* du client ?\n\n_Exemple : "Dupont SARL" ou "Marie Martin"_\n\n---\n💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._');
        return;
      }

      // Sélection par numéro
      const num = parseInt(input);
      if (!isNaN(num) && num >= 1 && num <= clientsList.length) {
        const selectedClient = clientsList[num - 1];
        const client = await prisma.client.findUnique({ where: { id: selectedClient.id } });
        
        if (!client) {
          await sendWhatsAppText(from, '⚠️ Client introuvable. Tapez *0* pour créer un nouveau client.');
          return;
        }

        // Passer aux lignes
        await prisma.devisDraft.update({
          where: { id: draft.id },
          data: { step: STEPS.ASKING_LIGNES, data: { clientId: client.id, clientNom: client.nom } },
        });
        await sendWhatsAppText(
          from,
          `✅ Client sélectionné : *${client.nom}*\n\n` +
          `📋 *ÉTAPE 2/4 : Lignes du devis*\n\n` +
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

    case STEPS.ASKING_NEW_CLIENT_NAME: {
      const clientName = text.trim();
      
      if (!clientName || clientName.length < 2) {
        await sendWhatsAppText(from, '⚠️ Nom invalide. Veuillez entrer un nom de client valide (au moins 2 caractères).');
        return;
      }

      // Vérifier si le client existe déjà
      const existingClient = await prisma.client.findFirst({
        where: {
          entrepriseId: entreprise.id,
          nom: { equals: clientName, mode: 'insensitive' },
        },
      });

      if (existingClient) {
        await sendWhatsAppText(
          from,
          `⚠️ Un client nommé "*${existingClient.nom}*" existe déjà.\n\n` +
          `Voulez-vous l'utiliser ?\n` +
          `• *OUI* - Utiliser ce client\n` +
          `• *NON* - Entrer un autre nom`
        );
        await prisma.devisDraft.update({
          where: { id: draft.id },
          data: { 
            step: STEPS.CREATING_CLIENT, 
            data: { existingClientId: existingClient.id, clientNom: existingClient.nom } 
          },
        });
        return;
      }

      // Enregistrer le nom et demander l'adresse
      await prisma.devisDraft.update({
        where: { id: draft.id },
        data: { step: STEPS.ASKING_NEW_CLIENT_ADDRESS, data: { clientNom: clientName } },
      });
      await sendWhatsAppText(
        from,
        `✅ Nom : *${clientName}*\n\n` +
        `📋 *ÉTAPE 1/4 : Adresse du client*\n\n` +
        `📍 Quelle est l'*adresse* du client ?\n\n` +
        `_Exemple : "12 rue des Lilas, 75020 Paris"_\n\n` +
        `💡 Tapez *ok* si vous ne souhaitez pas renseigner d'adresse.\n\n` +
        `---\n` +
        `💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._`
      );
      break;
    }

    case STEPS.ASKING_NEW_CLIENT_ADDRESS: {
      const data = draft.data as { clientNom: string };
      const lowerInput = text.toLowerCase().trim();
      const address = (lowerInput === 'ok' || lowerInput === '-' || lowerInput === '') ? null : text.trim();

      // Créer le client
      const client = await prisma.client.create({
        data: {
          entrepriseId: entreprise.id,
          nom: data.clientNom,
          adresse: address,
        },
      });

      // Passer aux lignes
      await prisma.devisDraft.update({
        where: { id: draft.id },
        data: { step: STEPS.ASKING_LIGNES, data: { clientId: client.id, clientNom: client.nom } },
      });

      await sendWhatsAppText(
        from,
        `✅ Client "*${client.nom}*" créé !\n\n` +
        `📋 *ÉTAPE 2/4 : Lignes du devis*\n\n` +
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

    case STEPS.CREATING_CLIENT: {
      await handleCreatingClient(from, phone, text, draft.data, draft, user);
      break;
    }

    case STEPS.ASKING_LIGNES: {
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

      const totalHT = lignes.reduce((sum: number, l: any) => sum + l.quantite * l.prixUnitaireHT, 0);

      await sendWhatsAppText(
        from,
        `✅ *Lignes ajoutées :*\n` +
        `${lignes.map((l: any) => `• ${l.quantite} × ${l.description} à ${l.prixUnitaireHT}€ HT`).join('\n')}\n\n` +
        `💰 *Total HT : ${totalHT.toFixed(2)}€*\n\n` +
        `📋 *ÉTAPE 3/4 : Validité du devis*\n\n` +
        `⏱️ Combien de jours de validité ?\n\n` +
        `_Tapez un nombre (ex: 30) ou tapez *ok* pour 30 jours par défaut._\n\n` +
        `---\n` +
        `💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._`
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
      const lowerInput = text.toLowerCase().trim();
      const validiteJours = (lowerInput === 'ok' || lowerInput === '') ? 30 : (parseInt(text) || 30);

      await sendWhatsAppText(
        from, 
        `✅ Validité : *${validiteJours} jours*\n\n` +
        `📋 *ÉTAPE 4/4 : Conditions de paiement*\n\n` +
        `💳 Quelles sont les conditions de paiement ?\n\n` +
        `_Exemples :_\n` +
        `• "30 jours net"\n` +
        `• "À réception"\n` +
        `• "50% à la commande, 50% à la livraison"\n\n` +
        `💡 Tapez *ok* pour utiliser "30 jours net" par défaut.\n\n` +
        `---\n` +
        `💡 _Tapez *annuler* pour quitter, *menu* pour le menu, ou *statut* pour voir où vous en êtes._`
      );

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
      const lowerInput = text.toLowerCase().trim();
      const conditions = (lowerInput === 'ok' || lowerInput === '-' || lowerInput === '') ? '30 jours net' : text.trim();

      const client = await prisma.client.findUnique({ where: { id: draft.data.clientId } });
      if (!client) {
        await sendWhatsAppText(from, '❌ Erreur : client introuvable. Dites "Créer un devis" pour recommencer.');
        await prisma.devisDraft.delete({ where: { id: draft.id } });
        return;
      }

      await sendWhatsAppText(from, '⏳ Génération du devis en cours...');

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

      // Utiliser la nomenclature correcte pour le fichier
      const nomFichier = genererNomFichierDevis(numero, client.nom);
      const pdfUrl = await uploadPDFTemporary(pdfBuffer, nomFichier);

      await sendWhatsAppDocument(from, pdfUrl, nomFichier, `📄 Voici votre devis ${numero}`);

      await sendWhatsAppText(
        from, 
        `🎉 *Devis ${numero} créé avec succès !*\n\n` +
        `📊 *Récapitulatif :*\n` +
        `• Client : ${client.nom}\n` +
        `• Total HT : ${draft.data.totalHT.toFixed(2)}€\n` +
        `• Validité : ${draft.data.validiteJours} jours\n` +
        `• Conditions : ${conditions}\n\n` +
        `Que souhaitez-vous faire maintenant ?\n` +
        `• Tapez *facture* pour le transformer en facture\n` +
        `• Tapez *devis* pour créer un autre devis\n` +
        `• Tapez *menu* pour voir toutes les options`
      );

      await prisma.devisDraft.delete({ where: { id: draft.id } });
      break;
    }

    default:
      await sendWhatsAppText(from, `État inconnu. Recommençons un nouveau devis ?`);
      await prisma.devisDraft.delete({ where: { id: draft.id } });
      break;
  }
}