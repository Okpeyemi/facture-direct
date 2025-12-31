// Enum défini localement pour éviter les problèmes de génération Prisma
type RegimeTVA = 
  | 'ASSUJETTI_CLASSIQUE'
  | 'FRANCHISE_BASE'
  | 'OPTION_TVA'
  | 'ASSOCIATION_NON_LUCRATIVE'
  | 'ASSUJETTI_OUTRE_MER';

export const STEPS = {
  WAITING_YES: 'waiting_yes',
  ASKING_NOM_ENTREPRISE: 'asking_nom_entreprise',
  ASKING_ADRESSE: 'asking_adresse',
  ASKING_SIREN: 'asking_siren',
  ASKING_REGIME_TVA: 'asking_regime_tva',
  ASKING_PHRASE_SECRETE: 'asking_phrase_secrete',
  COMPLETED: 'completed',
};

// Labels conviviaux pour les régimes TVA
export const REGIME_TVA_LABELS: Record<RegimeTVA, string> = {
  ASSUJETTI_CLASSIQUE: 'assujetti classique (TVA à 20%)',
  FRANCHISE_BASE: 'franchise de base (exonéré de TVA)',
  OPTION_TVA: 'option TVA (assujetti sur option)',
  ASSOCIATION_NON_LUCRATIVE: 'association non lucrative (exonérée de TVA)',
  ASSUJETTI_OUTRE_MER: 'assujetti outre-mer (TVA spécifique DOM-TOM)',
};

// Messages constants
export const MESSAGES = {
  WELCOME: 'Bienvenue sur FactureDirect !\n\nSouhaitez-vous créer votre compte ? Répondez *OUI* pour commencer.',
  ASK_NOM: 'Quel est le nom de votre entreprise ?',
  ERROR_NOM: 'Je n\'ai pas compris le nom de votre entreprise. Veuillez le répéter.',
  ASK_ADRESSE: 'Quelle est l\'adresse complète de votre entreprise ?',
  ERROR_ADRESSE: 'Je n\'ai pas compris l\'adresse. Veuillez la répéter.',
  ASK_SIREN: 'Quel est le numéro de SIREN de votre entreprise ?',
  ERROR_SIREN: 'Le SIREN doit contenir exactement 9 chiffres. Veuillez corriger.',
  ASK_REGIME: `Quel est votre régime TVA ?\n\nOptions :\n• Assujetti classique (TVA à 20%)\n• Franchise de base (exonéré de TVA)\n• Option TVA (assujetti sur option)\n• Association non lucrative (exonérée de TVA)\n• Assujetti outre-mer (TVA spécifique DOM-TOM)`,
  ERROR_REGIME: 'Régime TVA non reconnu. Veuillez choisir parmi les options proposées.',
  ASK_PHRASE: 'Quelle est votre phrase secrète (au moins 5 caractères) ?',
  ERROR_PHRASE: 'La phrase secrète doit contenir au moins 5 caractères. Veuillez corriger.',
  COMPLETED: '🎉 Félicitations ! Votre compte FactureDirect est créé. Tapez /menu pour voir les options.',
  INVALID_YES: 'Répondez *OUI* pour commencer la création de votre compte.',
  EXPIRED: 'Session expirée. Tapez "bonjour" pour recommencer.',
};