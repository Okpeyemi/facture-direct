// src/lib/bot/conversation/service.ts

import { prisma } from '@/lib/prisma';
import type {
  ConversationData,
  ConversationMessage,
  ConversationSession,
  IntentAnalysis,
} from './types';

const MAX_HISTORY_MESSAGES = 20;
const CONVERSATION_EXPIRY_DAYS = 7;

/**
 * Récupère ou crée une session de conversation pour un téléphone
 */
export async function getOrCreateSession(phone: string): Promise<ConversationSession> {
  console.log(`[Session] getOrCreateSession pour: ${phone}`);
  
  // 1. Vérifier si l'utilisateur existe
  const user = await prisma.utilisateur.findUnique({
    where: { telephone: phone },
    include: { entreprise: true },
  });

  console.log(`[Session] Utilisateur trouvé: ${!!user}, Entreprise: ${user?.entreprise?.nom || 'N/A'}`);

  const isNewUser = !user || user.entreprise.nom === 'En cours de création';
  console.log(`[Session] isNewUser: ${isNewUser}`);

  // 2. Récupérer ou créer l'état de conversation
  let convState = await prisma.conversationState.findUnique({
    where: { telephone: phone },
  });

  if (!convState) {
    convState = await prisma.conversationState.create({
      data: {
        telephone: phone,
        step: isNewUser ? 'onboarding_welcome' : 'main',
        data: {
          messages: [],
          context: {},
        },
        expiresAt: new Date(Date.now() + CONVERSATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  }

  // 3. Parser les données (cast via unknown pour compatibilité Prisma Json)
  const rawData = convState.data as unknown;
  const data: ConversationData = (rawData && typeof rawData === 'object' && 'messages' in rawData)
    ? rawData as ConversationData
    : { messages: [], context: {} };

  return {
    id: convState.id,
    phone,
    step: convState.step,
    data,
    isNewUser,
    user: user && !isNewUser
      ? {
          id: user.id,
          nom: user.nom,
          entreprise: {
            id: user.entreprise.id,
            nom: user.entreprise.nom,
          },
        }
      : undefined,
  };
}

/**
 * Ajoute un message à l'historique de conversation
 */
export async function addMessageToHistory(
  phone: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const convState = await prisma.conversationState.findUnique({
    where: { telephone: phone },
  });

  if (!convState) return;

  const rawData = convState.data as unknown;
  const data: ConversationData = (rawData && typeof rawData === 'object' && 'messages' in rawData)
    ? rawData as ConversationData
    : { messages: [] };
  const messages = data.messages || [];

  // Ajouter le nouveau message
  messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });

  // Garder seulement les N derniers messages
  const trimmedMessages = messages.slice(-MAX_HISTORY_MESSAGES);

  await prisma.conversationState.update({
    where: { telephone: phone },
    data: {
      data: JSON.parse(JSON.stringify({
        ...data,
        messages: trimmedMessages,
      })),
      expiresAt: new Date(Date.now() + CONVERSATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    },
  });
}

/**
 * Met à jour l'état de la conversation
 */
export async function updateConversationState(
  phone: string,
  updates: {
    step?: string;
    lastIntent?: IntentAnalysis;
    pendingModules?: any[];
    context?: Record<string, unknown>;
  }
): Promise<void> {
  const convState = await prisma.conversationState.findUnique({
    where: { telephone: phone },
  });

  if (!convState) return;

  const rawCurrentData = convState.data as unknown;
  const currentData: ConversationData = (rawCurrentData && typeof rawCurrentData === 'object' && 'messages' in rawCurrentData)
    ? rawCurrentData as ConversationData
    : { messages: [] };

  const newData = {
    ...currentData,
    lastIntent: updates.lastIntent ?? currentData.lastIntent,
    pendingModules: updates.pendingModules ?? currentData.pendingModules,
    context: {
      ...currentData.context,
      ...updates.context,
    },
  };

  await prisma.conversationState.update({
    where: { telephone: phone },
    data: {
      step: updates.step ?? convState.step,
      data: JSON.parse(JSON.stringify(newData)),
      expiresAt: new Date(Date.now() + CONVERSATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    },
  });
}

/**
 * Récupère l'historique de conversation formaté pour le LLM
 */
export function getConversationHistoryForLLM(
  data: ConversationData,
  maxMessages: number = 10
): string {
  const messages = data.messages || [];
  const recent = messages.slice(-maxMessages);

  if (recent.length === 0) {
    return 'Aucun historique de conversation.';
  }

  return recent
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${m.content}`)
    .join('\n');
}

/**
 * Réinitialise la conversation (pour les commandes comme "menu" ou "annuler")
 */
export async function resetConversation(phone: string): Promise<void> {
  const convState = await prisma.conversationState.findUnique({
    where: { telephone: phone },
  });

  if (!convState) return;

  const rawData = convState.data as unknown;
  const currentData: ConversationData = (rawData && typeof rawData === 'object' && 'messages' in rawData)
    ? rawData as ConversationData
    : { messages: [] };

  await prisma.conversationState.update({
    where: { telephone: phone },
    data: {
      step: 'main',
      data: JSON.parse(JSON.stringify({
        messages: currentData.messages, // Garder l'historique
        context: {},
        pendingModules: [],
      })),
    },
  });
}

/**
 * Supprime les conversations expirées
 */
export async function cleanupExpiredConversations(): Promise<number> {
  const result = await prisma.conversationState.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });

  return result.count;
}
