// src/lib/bot/index.ts

import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';
import { handleOnboarding } from './onboarding';
import { handleDevisCreation } from './devis/index';
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
      // Détection d'intention avec Groq (robuste et naturel)
      const intent = await detectIntent(text);

      console.log(`Intent détectée pour ${phone} :`, intent);

      switch (intent) {
        case 'create_devis':
          return await handleDevisCreation(from, phone, user);

        case 'create_facture':
          await sendWhatsAppText(from, '🚧 Création de facture en cours de développement ! Bientôt disponible.');
          return;

        case 'list_devis':
          await sendWhatsAppText(from, '📋 Voici vos 3 derniers devis :\n- DEV-2025-012 → Martin SARL (1 800 €)\n- DEV-2025-011 → Dubois SAS (2 400 €)\n- DEV-2025-010 → Léa Dupont (900 €)');
          return;

        case 'list_factures':
          await sendWhatsAppText(from, '📊 Voici vos 3 dernières factures :\n- FACT-2025-087 → Payée\n- FACT-2025-086 → En attente\n- FACT-2025-085 → Payée');
          return;

        case 'show_menu':
          await sendWhatsAppText(
            from,
            `📋 Menu FactureDirect\n\n` +
            `• Créer un devis\n` +
            `• Créer une facture (bientôt)\n` +
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
          // Intention inconnue → on discute aussi (fallback plus naturel)
          return await handleChat(from, user, text);
      }
    }

    // Onboarding pour les nouveaux utilisateurs
    console.log(`[Bot] Utilisateur non trouvé ou incomplet, passage au onboarding`);
    await handleOnboarding(from, phone, text);

  } catch (error) {
    console.error('Erreur dans handleIncomingMessage:', error);
    await sendWhatsAppText(from, 'Désolé, une erreur technique est survenue. Réessayez dans quelques instants.');
  }
}