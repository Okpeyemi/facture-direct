import { prisma } from '@/lib/prisma';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';
import { STEPS, MESSAGES } from './constants';
import {
  handleWaitingYes,
  handleAskingNomEntreprise,
  handleAskingAdresse,
  handleAskingSiren,
  handleAskingRegimeTVA,
  handleAskingPhraseSecrete,
} from './handlers';
import type { OnboardingData } from './types';

export async function handleOnboarding(from: string, phone: string, text: string) {
  

  // Récupérer l'état de conversation
  const state = await prisma.conversationState.findUnique({
    where: { telephone: phone },
  });

  if (!state) {
    // Premier message : envoyer le message de bienvenue
    await sendWhatsAppText(from, MESSAGES.WELCOME);
    await prisma.conversationState.create({
      data: {
        telephone: phone,
        step: STEPS.WAITING_YES,
        data: {},
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
      },
    });
    return;
  }

  const currentStep = state.step;
  const data = state.data as OnboardingData;

  const handlers: Record<string, (from: string, phone: string, text: string, data: OnboardingData) => Promise<void>> = {
    [STEPS.WAITING_YES]: handleWaitingYes,
    [STEPS.ASKING_NOM_ENTREPRISE]: handleAskingNomEntreprise,
    [STEPS.ASKING_ADRESSE]: handleAskingAdresse,
    [STEPS.ASKING_SIREN]: handleAskingSiren,
    [STEPS.ASKING_REGIME_TVA]: handleAskingRegimeTVA,
    [STEPS.ASKING_PHRASE_SECRETE]: handleAskingPhraseSecrete,
  };

  if (handlers[currentStep]) {
    await handlers[currentStep](from, phone, text, data);
  } else {
    await sendWhatsAppText(from, MESSAGES.EXPIRED);
    await prisma.conversationState.delete({ where: { telephone: phone } });
  }
}