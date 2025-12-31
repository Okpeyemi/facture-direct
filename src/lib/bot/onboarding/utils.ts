import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import type { OnboardingData } from './types';

// Fonction helper pour mettre à jour l'état
export async function updateState(phone: string, step: string, data: OnboardingData) {
  await prisma.conversationState.update({
    where: { telephone: phone },
    data: { step, data: data as Prisma.InputJsonValue, updatedAt: new Date() },
  });
}