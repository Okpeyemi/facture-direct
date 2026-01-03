// src/lib/bot/conversation/types.ts

/**
 * Message dans l'historique de conversation
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * Données stockées dans ConversationState.data
 */
export interface ConversationData {
  messages: ConversationMessage[];
  lastIntent?: IntentAnalysis;
  pendingModules?: ModuleExecution[];
  context?: Record<string, unknown>;
}

/**
 * Modules disponibles dans le bot
 */
export type ModuleType =
  | 'onboarding'
  | 'create_client'
  | 'search_client'
  | 'create_devis'
  | 'create_facture'
  | 'list_devis'
  | 'list_factures'
  | 'view_devis'
  | 'view_facture'
  | 'print_devis'
  | 'print_facture'
  | 'validate_facture'
  | 'settings'
  | 'chat';

/**
 * Entités extraites du message utilisateur
 */
export interface ExtractedEntities {
  clientName?: string;
  companyName?: string;
  amount?: number;
  description?: string;
  quantity?: number;
  date?: string;
  devisNumber?: string;
  factureNumber?: string;
}

/**
 * Exécution d'un module avec ses paramètres
 */
export interface ModuleExecution {
  module: ModuleType;
  params: Record<string, unknown>;
  order: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

/**
 * Résultat de l'analyse d'intention
 */
export interface IntentAnalysis {
  intent: string;
  confidence: number;
  entities: ExtractedEntities;
  modules: ModuleExecution[];
  naturalResponse: string;
  needsMoreInfo: boolean;
  missingInfo?: string[];
}

/**
 * Session de conversation
 */
export interface ConversationSession {
  id: string;
  phone: string;
  step: string;
  data: ConversationData;
  isNewUser: boolean;
  user?: {
    id: string;
    nom: string;
    entreprise: {
      id: string;
      nom: string;
    };
  };
}
