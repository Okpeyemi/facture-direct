// src/lib/bot/facture/constants.ts

export const FACTURE_STEPS = {
  CHOOSING_SOURCE: 'choosing_source',           // Choisir: depuis devis ou nouvelle facture
  SELECTING_DEVIS: 'selecting_devis',           // Sélection d'un devis à transformer
  ASKING_CLIENT: 'asking_client',               // Sélection du client (si nouvelle facture)
  ASKING_NEW_CLIENT_NAME: 'asking_new_client_name',
  ASKING_NEW_CLIENT_ADDRESS: 'asking_new_client_address',
  ASKING_LIGNES: 'asking_lignes',               // Saisie des lignes
  ASKING_CONDITIONS: 'asking_conditions',       // Conditions de paiement
  CONFIRMING: 'confirming',                     // Confirmation avant création
  ASKING_VALIDATION: 'asking_validation',       // Demander si on valide la facture
};
