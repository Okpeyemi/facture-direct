// src/lib/bot/facture/types.ts

export interface FactureDraftData {
  source?: 'devis' | 'nouvelle';
  devisId?: string;
  clientId?: string;
  clientNom?: string;
  lignes?: LigneFacture[];
  totalHT?: number;
  totalTVA?: number;
  totalTTC?: number;
  conditionsPaiement?: string;
  clientsList?: { id: string; nom: string }[];
  devisList?: { id: string; numero: string; clientNom: string; totalTTC: number }[];
}

export interface LigneFacture {
  description: string;
  quantite: number;
  prixUnitaireHT: number;
  tauxTVA: number;
}

export interface FactureDraft {
  id: string;
  utilisateurId: string;
  step: string;
  data: FactureDraftData;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
