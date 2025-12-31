import { sendWhatsAppText } from '@/lib/whatsapp-utils';
import { RegimeTVA } from '@prisma/client';
import { STEPS, MESSAGES } from './constants';
import { extractData } from './extractor';
import { createUserAndCompany } from './user-creation';
import { updateState } from './utils';
import type { OnboardingData } from './types';

// Handlers pour chaque étape
export async function handleWaitingYes(from: string, phone: string, text: string, data: OnboardingData) {
  const normalizedText = text.toLowerCase().trim();
  if (normalizedText === 'oui' || normalizedText === 'yes' || normalizedText === 'o') {
    await sendWhatsAppText(from, MESSAGES.ASK_NOM);
    await updateState(phone, STEPS.ASKING_NOM_ENTREPRISE, data);
  } else {
    await sendWhatsAppText(from, MESSAGES.INVALID_YES);
  }
}

export async function handleAskingNomEntreprise(from: string, phone: string, text: string, data: OnboardingData) {
  const nomData = await extractData(STEPS.ASKING_NOM_ENTREPRISE, text);

  if (nomData?.nomEntreprise) {
    data.nomEntreprise = nomData.nomEntreprise;
    // Si l'IA a généré une réponse de confirmation, on l'utilise, sinon on passe à la suite
    if (nomData.reply) await sendWhatsAppText(from, nomData.reply);

    await sendWhatsAppText(from, MESSAGES.ASK_ADRESSE);
    await updateState(phone, STEPS.ASKING_ADRESSE, data);
  } else {
    // L'IA n'a pas trouvé, on renvoie sa demande de clarification
    await sendWhatsAppText(from, nomData?.reply || MESSAGES.ERROR_NOM);
  }
}

export async function handleAskingAdresse(from: string, phone: string, text: string, data: OnboardingData) {
  const addrData = await extractData(STEPS.ASKING_ADRESSE, text);

  if (addrData?.adresse) {
    data.adresse = addrData.adresse;
    if (addrData.reply) await sendWhatsAppText(from, addrData.reply);

    await sendWhatsAppText(from, MESSAGES.ASK_SIREN);
    await updateState(phone, STEPS.ASKING_SIREN, data);
  } else {
    await sendWhatsAppText(from, addrData?.reply || MESSAGES.ERROR_ADRESSE);
  }
}

export async function handleAskingSiren(from: string, phone: string, text: string, data: OnboardingData) {
  const sirenData = await extractData(STEPS.ASKING_SIREN, text);

  // Validation plus souple : si l'IA a extrait un SIREN, on le prend
  if (sirenData?.siren) {
    data.siren = sirenData.siren;
    if (sirenData.reply) await sendWhatsAppText(from, sirenData.reply);

    await sendWhatsAppText(from, MESSAGES.ASK_REGIME);
    await updateState(phone, STEPS.ASKING_REGIME_TVA, data);
  } else {
    await sendWhatsAppText(from, sirenData?.reply || MESSAGES.ERROR_SIREN);
  }
}

export async function handleAskingRegimeTVA(from: string, phone: string, text: string, data: OnboardingData) {
  const regimeData = await extractData(STEPS.ASKING_REGIME_TVA, text);

  if (regimeData?.regimeTVA) {
    data.regimeTVA = regimeData.regimeTVA;
    if (regimeData.reply) await sendWhatsAppText(from, regimeData.reply);

    await sendWhatsAppText(from, MESSAGES.ASK_PHRASE);
    await updateState(phone, STEPS.ASKING_PHRASE_SECRETE, data);
  } else {
    await sendWhatsAppText(from, regimeData?.reply || MESSAGES.ERROR_REGIME);
  }
}

export async function handleAskingPhraseSecrete(from: string, phone: string, text: string, data: OnboardingData) {
  const phrase = text.trim();
  if (phrase.length >= 5) {
    data.phraseSecrete = phrase;
    await createUserAndCompany(phone, data);
    await sendWhatsAppText(from, MESSAGES.COMPLETED);
    await updateState(phone, STEPS.COMPLETED, {});
  } else {
    await sendWhatsAppText(from, MESSAGES.ERROR_PHRASE);
  }
}