import { prisma } from '@/lib/prisma';

// Réinitialise complètement le contexte de conversation pour un utilisateur (suppression de la row)
export async function resetConversation(phone: string) {
	await prisma.conversationState.deleteMany({
		where: { telephone: phone },
	});
}
// src/lib/bot/conversation/index.ts

export * from './types';
export * from './service';
export * from './analyzer';
