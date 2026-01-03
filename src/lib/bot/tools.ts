// src/lib/bot/tools.ts
// Tous les tools (opérations BD) que le LLM peut utiliser

import { prisma } from '@/lib/prisma';
import { genererFacturePDF, genererDevisPDF } from '@/lib/pdf-generator';
import { uploadPDFTemporary, genererNomFichierFacture, genererNomFichierDevis } from '@/lib/bot/utils/devis';
import { sendWhatsAppDocument, sendWhatsAppText } from '@/lib/whatsapp-utils';

// ============================================================================
// TYPES
// ============================================================================

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ClientData {
  id: string;
  nom: string;
  adresse?: string | null;
  siren?: string | null;
  tvaIntra?: string | null;
}

export interface DevisData {
  id: string;
  numero: string;
  date: Date;
  statut: string;
  client: ClientData;
  lignes: { description: string; quantite: number; prixUnitaireHT: number }[];
  totalHT: number;
  totalTTC: number;
}

export interface FactureData {
  id: string;
  numero: string;
  dateCreation: Date;
  dateEmission?: Date | null;
  statut: string;
  client: ClientData;
  lignes: { description: string; quantite: number; prixUnitaireHT: number; tauxTVA: number }[];
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
}

// ============================================================================
// TOOLS CLIENTS
// ============================================================================

/**
 * Recherche des clients par nom ou entreprise
 */
export async function searchClient(
  entrepriseId: string,
  query: string
): Promise<ToolResult<ClientData[]>> {
  try {
    const clients = await prisma.client.findMany({
      where: {
        entrepriseId,
        nom: { contains: query, mode: 'insensitive' },
      },
      take: 10,
    });

    return {
      success: true,
      data: clients.map(c => ({
        id: c.id,
        nom: c.nom,
        adresse: c.adresse,
        siren: c.siren,
        tvaIntra: c.tvaIntra,
      })),
    };
  } catch (error) {
    console.error('[Tool] searchClient error:', error);
    return { success: false, error: 'Erreur lors de la recherche de clients' };
  }
}

/**
 * Crée un nouveau client
 */
export async function createClient(
  entrepriseId: string,
  data: { nom: string; adresse?: string; siren?: string; tvaIntra?: string }
): Promise<ToolResult<ClientData>> {
  try {
    const client = await prisma.client.create({
      data: {
        entrepriseId,
        nom: data.nom,
        adresse: data.adresse,
        siren: data.siren,
        tvaIntra: data.tvaIntra,
      },
    });

    return {
      success: true,
      data: {
        id: client.id,
        nom: client.nom,
        adresse: client.adresse,
        siren: client.siren,
        tvaIntra: client.tvaIntra,
      },
    };
  } catch (error) {
    console.error('[Tool] createClient error:', error);
    return { success: false, error: 'Erreur lors de la création du client' };
  }
}

/**
 * Liste tous les clients d'une entreprise
 */
export async function getClients(
  entrepriseId: string
): Promise<ToolResult<ClientData[]>> {
  try {
    const clients = await prisma.client.findMany({
      where: { entrepriseId },
      orderBy: { nom: 'asc' },
    });

    return {
      success: true,
      data: clients.map(c => ({
        id: c.id,
        nom: c.nom,
        adresse: c.adresse,
        siren: c.siren,
        tvaIntra: c.tvaIntra,
      })),
    };
  } catch (error) {
    console.error('[Tool] getClients error:', error);
    return { success: false, error: 'Erreur lors de la récupération des clients' };
  }
}

/**
 * Récupère un client par ID
 */
export async function getClientById(
  clientId: string
): Promise<ToolResult<ClientData>> {
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      return { success: false, error: 'Client non trouvé' };
    }

    return {
      success: true,
      data: {
        id: client.id,
        nom: client.nom,
        adresse: client.adresse,
        siren: client.siren,
        tvaIntra: client.tvaIntra,
      },
    };
  } catch (error) {
    console.error('[Tool] getClientById error:', error);
    return { success: false, error: 'Erreur lors de la récupération du client' };
  }
}

// ============================================================================
// TOOLS DEVIS
// ============================================================================

/**
 * Crée un nouveau devis
 */
export async function createDevis(
  entrepriseId: string,
  data: {
    clientId: string;
    lignes: { description: string; quantite: number; prixUnitaireHT: number; tauxTVA?: number }[];
    validiteJours?: number;
  }
): Promise<ToolResult<DevisData>> {
  try {
    // Générer le numéro de devis
    const annee = new Date().getFullYear();
    const prefix = `DEV-${annee}-`;
    
    const dernierDevis = await prisma.devis.findFirst({
      where: { entrepriseId, numero: { startsWith: prefix } },
      orderBy: { numero: 'desc' },
    });

    let sequence = 1;
    if (dernierDevis) {
      const match = dernierDevis.numero.match(/DEV-\d{4}-(\d+)/);
      if (match) sequence = parseInt(match[1]) + 1;
    }
    const numero = `${prefix}${sequence.toString().padStart(4, '0')}`;

    // Créer le devis avec ses lignes
    const devis = await prisma.devis.create({
      data: {
        entrepriseId,
        clientId: data.clientId,
        numero,
        validiteJours: data.validiteJours || 30,
        statut: 'brouillon',
        lignes: {
          create: data.lignes.map(l => ({
            description: l.description,
            quantite: l.quantite,
            prixUnitaireHT: l.prixUnitaireHT,
            tauxTVA: l.tauxTVA || 20,
          })),
        },
      },
      include: { client: true, lignes: true },
    });

    const totalHT = devis.lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT, 0);
    const totalTTC = devis.lignes.reduce((sum, l) => {
      const ht = l.quantite * l.prixUnitaireHT;
      return sum + ht + (ht * l.tauxTVA / 100);
    }, 0);

    return {
      success: true,
      data: {
        id: devis.id,
        numero: devis.numero,
        date: devis.date,
        statut: devis.statut,
        client: {
          id: devis.client.id,
          nom: devis.client.nom,
          adresse: devis.client.adresse,
        },
        lignes: devis.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
        })),
        totalHT,
        totalTTC,
      },
    };
  } catch (error) {
    console.error('[Tool] createDevis error:', error);
    return { success: false, error: 'Erreur lors de la création du devis' };
  }
}

/**
 * Liste les devis d'une entreprise
 */
export async function getDevis(
  entrepriseId: string,
  limit: number = 10
): Promise<ToolResult<DevisData[]>> {
  try {
    const devis = await prisma.devis.findMany({
      where: { entrepriseId },
      include: { client: true, lignes: true },
      orderBy: { date: 'desc' },
      take: limit,
    });

    return {
      success: true,
      data: devis.map(d => {
        const totalHT = d.lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT, 0);
        const totalTTC = d.lignes.reduce((sum, l) => {
          const ht = l.quantite * l.prixUnitaireHT;
          return sum + ht + (ht * l.tauxTVA / 100);
        }, 0);

        return {
          id: d.id,
          numero: d.numero,
          date: d.date,
          statut: d.statut,
          client: {
            id: d.client.id,
            nom: d.client.nom,
            adresse: d.client.adresse,
          },
          lignes: d.lignes.map(l => ({
            description: l.description,
            quantite: l.quantite,
            prixUnitaireHT: l.prixUnitaireHT,
          })),
          totalHT,
          totalTTC,
        };
      }),
    };
  } catch (error) {
    console.error('[Tool] getDevis error:', error);
    return { success: false, error: 'Erreur lors de la récupération des devis' };
  }
}

/**
 * Récupère un devis par ID
 */
export async function getDevisById(
  devisId: string
): Promise<ToolResult<DevisData>> {
  try {
    const devis = await prisma.devis.findUnique({
      where: { id: devisId },
      include: { client: true, lignes: true },
    });

    if (!devis) {
      return { success: false, error: 'Devis non trouvé' };
    }

    const totalHT = devis.lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT, 0);
    const totalTTC = devis.lignes.reduce((sum, l) => {
      const ht = l.quantite * l.prixUnitaireHT;
      return sum + ht + (ht * l.tauxTVA / 100);
    }, 0);

    return {
      success: true,
      data: {
        id: devis.id,
        numero: devis.numero,
        date: devis.date,
        statut: devis.statut,
        client: {
          id: devis.client.id,
          nom: devis.client.nom,
          adresse: devis.client.adresse,
        },
        lignes: devis.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
        })),
        totalHT,
        totalTTC,
      },
    };
  } catch (error) {
    console.error('[Tool] getDevisById error:', error);
    return { success: false, error: 'Erreur lors de la récupération du devis' };
  }
}

/**
 * Met à jour le statut d'un devis
 */
export async function updateDevisStatut(
  devisId: string,
  statut: 'brouillon' | 'envoyé' | 'accepté' | 'refusé'
): Promise<ToolResult<{ id: string; statut: string }>> {
  try {
    const devis = await prisma.devis.update({
      where: { id: devisId },
      data: { statut },
    });

    return {
      success: true,
      data: { id: devis.id, statut: devis.statut },
    };
  } catch (error) {
    console.error('[Tool] updateDevisStatut error:', error);
    return { success: false, error: 'Erreur lors de la mise à jour du devis' };
  }
}

// ============================================================================
// TOOLS FACTURES
// ============================================================================

/**
 * Crée une facture à partir d'un devis
 */
export async function createFactureFromDevis(
  entrepriseId: string,
  utilisateurId: string,
  devisId: string
): Promise<ToolResult<FactureData>> {
  try {
    // Récupérer le devis
    const devis = await prisma.devis.findUnique({
      where: { id: devisId },
      include: { client: true, lignes: true },
    });

    if (!devis) {
      return { success: false, error: 'Devis non trouvé' };
    }

    // Vérifier qu'il n'y a pas déjà une facture
    const factureExistante = await prisma.facture.findFirst({
      where: { devisId },
    });

    if (factureExistante) {
      return { success: false, error: 'Ce devis a déjà une facture associée' };
    }

    // Générer le numéro de facture
    const annee = new Date().getFullYear();
    const prefix = `FACT-${annee}-`;
    
    const derniereFacture = await prisma.facture.findFirst({
      where: { entrepriseId, numero: { startsWith: prefix } },
      orderBy: { numero: 'desc' },
    });

    let sequence = 1;
    if (derniereFacture) {
      const match = derniereFacture.numero.match(/FACT-\d{4}-(\d+)/);
      if (match) sequence = parseInt(match[1]) + 1;
    }
    const numero = `${prefix}${sequence.toString().padStart(4, '0')}`;

    // Calculer les totaux
    const totalHT = devis.lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT, 0);
    const totalTVA = devis.lignes.reduce((sum, l) => {
      const ht = l.quantite * l.prixUnitaireHT;
      return sum + (ht * l.tauxTVA / 100);
    }, 0);
    const totalTTC = totalHT + totalTVA;

    // Créer la facture
    const facture = await prisma.facture.create({
      data: {
        entrepriseId,
        clientId: devis.clientId,
        devisId,
        numero,
        creeParId: utilisateurId,
        totalHT,
        totalTVA,
        totalTTC,
        lignes: {
          create: devis.lignes.map(l => ({
            description: l.description,
            quantite: l.quantite,
            prixUnitaireHT: l.prixUnitaireHT,
            tauxTVA: l.tauxTVA,
          })),
        },
      },
      include: { client: true, lignes: true },
    });

    return {
      success: true,
      data: {
        id: facture.id,
        numero: facture.numero,
        dateCreation: facture.dateCreation,
        dateEmission: facture.dateEmission,
        statut: facture.statut,
        client: {
          id: facture.client.id,
          nom: facture.client.nom,
          adresse: facture.client.adresse,
        },
        lignes: facture.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
          tauxTVA: l.tauxTVA,
        })),
        totalHT: facture.totalHT,
        totalTVA: facture.totalTVA,
        totalTTC: facture.totalTTC,
      },
    };
  } catch (error) {
    console.error('[Tool] createFactureFromDevis error:', error);
    return { success: false, error: 'Erreur lors de la création de la facture' };
  }
}

/**
 * Crée une facture directement (sans devis)
 */
export async function createFacture(
  entrepriseId: string,
  utilisateurId: string,
  data: {
    clientId: string;
    lignes: { description: string; quantite: number; prixUnitaireHT: number; tauxTVA?: number }[];
  }
): Promise<ToolResult<FactureData>> {
  try {
    // Générer le numéro de facture
    const annee = new Date().getFullYear();
    const prefix = `FACT-${annee}-`;
    
    const derniereFacture = await prisma.facture.findFirst({
      where: { entrepriseId, numero: { startsWith: prefix } },
      orderBy: { numero: 'desc' },
    });

    let sequence = 1;
    if (derniereFacture) {
      const match = derniereFacture.numero.match(/FACT-\d{4}-(\d+)/);
      if (match) sequence = parseInt(match[1]) + 1;
    }
    const numero = `${prefix}${sequence.toString().padStart(4, '0')}`;

    // Calculer les totaux
    const totalHT = data.lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT, 0);
    const totalTVA = data.lignes.reduce((sum, l) => {
      const ht = l.quantite * l.prixUnitaireHT;
      return sum + (ht * (l.tauxTVA || 20) / 100);
    }, 0);
    const totalTTC = totalHT + totalTVA;

    // Créer la facture
    const facture = await prisma.facture.create({
      data: {
        entrepriseId,
        clientId: data.clientId,
        numero,
        creeParId: utilisateurId,
        totalHT,
        totalTVA,
        totalTTC,
        lignes: {
          create: data.lignes.map(l => ({
            description: l.description,
            quantite: l.quantite,
            prixUnitaireHT: l.prixUnitaireHT,
            tauxTVA: l.tauxTVA || 20,
          })),
        },
      },
      include: { client: true, lignes: true },
    });

    return {
      success: true,
      data: {
        id: facture.id,
        numero: facture.numero,
        dateCreation: facture.dateCreation,
        dateEmission: facture.dateEmission,
        statut: facture.statut,
        client: {
          id: facture.client.id,
          nom: facture.client.nom,
          adresse: facture.client.adresse,
        },
        lignes: facture.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
          tauxTVA: l.tauxTVA,
        })),
        totalHT: facture.totalHT,
        totalTVA: facture.totalTVA,
        totalTTC: facture.totalTTC,
      },
    };
  } catch (error) {
    console.error('[Tool] createFacture error:', error);
    return { success: false, error: 'Erreur lors de la création de la facture' };
  }
}

/**
 * Liste les factures d'une entreprise
 */
export async function getFactures(
  entrepriseId: string,
  limit: number = 10
): Promise<ToolResult<FactureData[]>> {
  try {
    const factures = await prisma.facture.findMany({
      where: { entrepriseId },
      include: { client: true, lignes: true },
      orderBy: { dateCreation: 'desc' },
      take: limit,
    });

    return {
      success: true,
      data: factures.map(f => ({
        id: f.id,
        numero: f.numero,
        dateCreation: f.dateCreation,
        dateEmission: f.dateEmission,
        statut: f.statut,
        client: {
          id: f.client.id,
          nom: f.client.nom,
          adresse: f.client.adresse,
        },
        lignes: f.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
          tauxTVA: l.tauxTVA,
        })),
        totalHT: f.totalHT,
        totalTVA: f.totalTVA,
        totalTTC: f.totalTTC,
      })),
    };
  } catch (error) {
    console.error('[Tool] getFactures error:', error);
    return { success: false, error: 'Erreur lors de la récupération des factures' };
  }
}

/**
 * Récupère une facture par ID
 */
export async function getFactureById(
  factureId: string
): Promise<ToolResult<FactureData>> {
  try {
    const facture = await prisma.facture.findUnique({
      where: { id: factureId },
      include: { client: true, lignes: true },
    });

    if (!facture) {
      return { success: false, error: 'Facture non trouvée' };
    }

    return {
      success: true,
      data: {
        id: facture.id,
        numero: facture.numero,
        dateCreation: facture.dateCreation,
        dateEmission: facture.dateEmission,
        statut: facture.statut,
        client: {
          id: facture.client.id,
          nom: facture.client.nom,
          adresse: facture.client.adresse,
        },
        lignes: facture.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
          tauxTVA: l.tauxTVA,
        })),
        totalHT: facture.totalHT,
        totalTVA: facture.totalTVA,
        totalTTC: facture.totalTTC,
      },
    };
  } catch (error) {
    console.error('[Tool] getFactureById error:', error);
    return { success: false, error: 'Erreur lors de la récupération de la facture' };
  }
}

/**
 * Valide une facture (passe de BROUILLON à VALIDEE)
 */
export async function validateFacture(
  factureId: string,
  utilisateurId: string
): Promise<ToolResult<FactureData>> {
  try {
    const facture = await prisma.facture.update({
      where: { id: factureId },
      data: {
        statut: 'VALIDEE',
        dateEmission: new Date(),
        valideeParId: utilisateurId,
        valideeLe: new Date(),
      },
      include: { client: true, lignes: true },
    });

    return {
      success: true,
      data: {
        id: facture.id,
        numero: facture.numero,
        dateCreation: facture.dateCreation,
        dateEmission: facture.dateEmission,
        statut: facture.statut,
        client: {
          id: facture.client.id,
          nom: facture.client.nom,
          adresse: facture.client.adresse,
        },
        lignes: facture.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
          tauxTVA: l.tauxTVA,
        })),
        totalHT: facture.totalHT,
        totalTVA: facture.totalTVA,
        totalTTC: facture.totalTTC,
      },
    };
  } catch (error) {
    console.error('[Tool] validateFacture error:', error);
    return { success: false, error: 'Erreur lors de la validation de la facture' };
  }
}

// ============================================================================
// TOOLS ENTREPRISE / SETTINGS
// ============================================================================

export interface EntrepriseSettings {
  id: string;
  nom: string;
  siren?: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  tvaIntra?: string | null;
  iban?: string | null;
  bic?: string | null;
  regimeTVA: string;
  tauxTVADefaut: number;
}

/**
 * Récupère les paramètres de l'entreprise
 */
export async function getEntrepriseSettings(
  entrepriseId: string
): Promise<ToolResult<EntrepriseSettings>> {
  try {
    const entreprise = await prisma.entreprise.findUnique({
      where: { id: entrepriseId },
    });

    if (!entreprise) {
      return { success: false, error: 'Entreprise non trouvée' };
    }

    return {
      success: true,
      data: {
        id: entreprise.id,
        nom: entreprise.nom,
        siren: entreprise.siren,
        adresse: entreprise.adresse,
        codePostal: entreprise.codePostal,
        ville: entreprise.ville,
        tvaIntra: entreprise.tvaIntra,
        iban: entreprise.iban,
        bic: entreprise.bic,
        regimeTVA: entreprise.regimeTVA,
        tauxTVADefaut: entreprise.tauxTVADefaut,
      },
    };
  } catch (error) {
    console.error('[Tool] getEntrepriseSettings error:', error);
    return { success: false, error: 'Erreur lors de la récupération des paramètres' };
  }
}

/**
 * Met à jour les paramètres de l'entreprise
 */
export async function updateEntrepriseSettings(
  entrepriseId: string,
  data: Partial<Omit<EntrepriseSettings, 'id'>>
): Promise<ToolResult<EntrepriseSettings>> {
  try {
    const entreprise = await prisma.entreprise.update({
      where: { id: entrepriseId },
      data: {
        nom: data.nom,
        siren: data.siren,
        adresse: data.adresse,
        codePostal: data.codePostal,
        ville: data.ville,
        tvaIntra: data.tvaIntra,
        iban: data.iban,
        bic: data.bic,
        tauxTVADefaut: data.tauxTVADefaut,
      },
    });

    return {
      success: true,
      data: {
        id: entreprise.id,
        nom: entreprise.nom,
        siren: entreprise.siren,
        adresse: entreprise.adresse,
        codePostal: entreprise.codePostal,
        ville: entreprise.ville,
        tvaIntra: entreprise.tvaIntra,
        iban: entreprise.iban,
        bic: entreprise.bic,
        regimeTVA: entreprise.regimeTVA,
        tauxTVADefaut: entreprise.tauxTVADefaut,
      },
    };
  } catch (error) {
    console.error('[Tool] updateEntrepriseSettings error:', error);
    return { success: false, error: 'Erreur lors de la mise à jour des paramètres' };
  }
}

// ============================================================================
// TOOLS UTILISATEUR / ONBOARDING
// ============================================================================

/**
 * Crée un nouvel utilisateur et son entreprise
 */
export async function createUserWithEntreprise(
  phone: string,
  data: {
    nom: string;
    email?: string;
    entrepriseNom: string;
    entrepriseAdresse?: string;
    entrepriseSiren?: string;
  }
): Promise<ToolResult<{ userId: string; entrepriseId: string }>> {
  try {
    // Créer l'entreprise
    const entreprise = await prisma.entreprise.create({
      data: {
        nom: data.entrepriseNom,
        adresse: data.entrepriseAdresse,
        siren: data.entrepriseSiren,
      },
    });

    // Créer l'utilisateur
    const user = await prisma.utilisateur.create({
      data: {
        telephone: phone,
        nom: data.nom,
        email: data.email,
        role: 'ADMIN',
        entrepriseId: entreprise.id,
      },
    });

    return {
      success: true,
      data: {
        userId: user.id,
        entrepriseId: entreprise.id,
      },
    };
  } catch (error) {
    console.error('[Tool] createUserWithEntreprise error:', error);
    return { success: false, error: 'Erreur lors de la création du compte' };
  }
}

/**
 * Récupère l'état de conversation (pour l'onboarding)
 */
export async function getConversationState(
  phone: string
): Promise<ToolResult<{ step: string; data: any }>> {
  try {
    const state = await prisma.conversationState.findUnique({
      where: { telephone: phone },
    });

    if (!state) {
      return { success: true, data: { step: 'new', data: {} } };
    }

    return {
      success: true,
      data: {
        step: state.step,
        data: state.data || {},
      },
    };
  } catch (error) {
    console.error('[Tool] getConversationState error:', error);
    return { success: false, error: 'Erreur lors de la récupération de l\'état' };
  }
}

/**
 * Met à jour l'état de conversation
 */
export async function updateConversationState(
  phone: string,
  step: string,
  data: Record<string, unknown>
): Promise<ToolResult<{ step: string }>> {
  try {
    await prisma.conversationState.upsert({
      where: { telephone: phone },
      create: {
        telephone: phone,
        step,
        data: JSON.parse(JSON.stringify(data)),
      },
      update: {
        step,
        data: JSON.parse(JSON.stringify(data)),
      },
    });

    return { success: true, data: { step } };
  } catch (error) {
    console.error('[Tool] updateConversationState error:', error);
    return { success: false, error: 'Erreur lors de la mise à jour de l\'état' };
  }
}

// ============================================================================
// PDF ET ENVOI WHATSAPP
// ============================================================================

/**
 * Génère le PDF d'une facture, l'upload sur Vercel Blob et l'envoie via WhatsApp
 */
export async function generateAndSendFacturePDF(
  factureId: string,
  phoneNumber: string
): Promise<ToolResult<{ pdfUrl: string }>> {
  try {
    console.log('[Tool] generateAndSendFacturePDF:', factureId);
    
    // Récupérer la facture complète
    const facture = await prisma.facture.findUnique({
      where: { id: factureId },
      include: {
        client: true,
        lignes: true,
        entreprise: true,
      },
    });
    
    if (!facture) {
      return { success: false, error: 'Facture non trouvée' };
    }
    
    // Calculer TVA
    const tauxTVA = facture.lignes[0]?.tauxTVA || 20;
    
    // Générer le PDF
    const pdfBuffer = await genererFacturePDF({
      facture: {
        numero: facture.numero,
        dateEmission: facture.dateEmission || new Date(),
        estValidee: facture.statut === 'VALIDEE',
        lignes: facture.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
          tauxTVA: l.tauxTVA || 20,
        })),
        totalHT: facture.totalHT,
        totalTVA: facture.totalTVA,
        totalTTC: facture.totalTTC,
        tauxTVA,
        conditionsPaiement: facture.entreprise.mentionsLegales || 'Paiement à réception',
      },
      entreprise: {
        nom: facture.entreprise.nom,
        adresse: facture.entreprise.adresse,
        codePostal: facture.entreprise.codePostal,
        ville: facture.entreprise.ville,
        siren: facture.entreprise.siren,
        tvaIntra: facture.entreprise.tvaIntra,
        iban: facture.entreprise.iban,
        bic: facture.entreprise.bic,
        regimeTVA: facture.entreprise.regimeTVA,
        mentionTVALegale: facture.entreprise.mentionTVALegale,
        mentionsLegales: facture.entreprise.mentionsLegales,
      },
      client: {
        nom: facture.client.nom,
        adresse: facture.client.adresse,
        siren: facture.client.siren,
        tvaIntra: facture.client.tvaIntra,
      },
    });
    
    console.log(`[Tool] PDF généré (${pdfBuffer.length} bytes)`);
    
    // Upload sur Vercel Blob
    const estBrouillon = facture.statut === 'BROUILLON';
    const nomFichier = genererNomFichierFacture(facture.numero, facture.client.nom, estBrouillon);
    const pdfUrl = await uploadPDFTemporary(pdfBuffer, nomFichier);
    
    console.log(`[Tool] PDF uploadé: ${pdfUrl}`);
    
    // Envoyer via WhatsApp
    const caption = estBrouillon 
      ? `📄 Voici votre facture ${facture.numero} (BROUILLON)\n\nTapez "valider" pour finaliser.`
      : `📄 Voici votre facture ${facture.numero} validée.`;
    
    await sendWhatsAppDocument(phoneNumber, pdfUrl, nomFichier, caption);
    
    console.log('[Tool] Document WhatsApp envoyé');
    
    return { success: true, data: { pdfUrl } };
  } catch (error) {
    console.error('[Tool] generateAndSendFacturePDF error:', error);
    return { success: false, error: `Erreur génération PDF: ${error}` };
  }
}

/**
 * Génère le PDF d'un devis, l'upload sur Vercel Blob et l'envoie via WhatsApp
 */
export async function generateAndSendDevisPDF(
  devisId: string,
  phoneNumber: string
): Promise<ToolResult<{ pdfUrl: string }>> {
  try {
    console.log('[Tool] generateAndSendDevisPDF:', devisId);
    
    // Récupérer le devis complet
    const devis = await prisma.devis.findUnique({
      where: { id: devisId },
      include: {
        client: true,
        lignes: true,
        entreprise: true,
      },
    });
    
    if (!devis) {
      return { success: false, error: 'Devis non trouvé' };
    }
    
    // Calculer date validité et totaux
    const validiteJours = devis.validiteJours || 30;
    const dateValidite = new Date(devis.date);
    dateValidite.setDate(dateValidite.getDate() + validiteJours);
    
    // Calculer les totaux depuis les lignes si pas disponibles
    const totalHT = devis.lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaireHT, 0);
    const tauxTVA = 20;
    const totalTTC = totalHT * (1 + tauxTVA / 100);
    
    // Générer le PDF
    const pdfBuffer = await genererDevisPDF({
      devis: {
        numero: devis.numero,
        date: devis.date,
        dateValidite,
        lignes: devis.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite,
          prixUnitaireHT: l.prixUnitaireHT,
        })),
        totalHT,
        totalTTC,
        tauxTVA,
        conditionsPaiement: devis.entreprise.mentionsLegales || 'Devis valable 30 jours',
      },
      entreprise: {
        nom: devis.entreprise.nom,
        adresse: devis.entreprise.adresse,
        siren: devis.entreprise.siren,
        tvaIntra: devis.entreprise.tvaIntra,
        mentionTVALegale: devis.entreprise.mentionTVALegale,
      },
      client: {
        nom: devis.client.nom,
        adresse: devis.client.adresse,
        siren: devis.client.siren,
        tvaIntra: devis.client.tvaIntra,
      },
    });
    
    console.log(`[Tool] PDF devis généré (${pdfBuffer.length} bytes)`);
    
    // Upload sur Vercel Blob
    const nomFichier = genererNomFichierDevis(devis.numero, devis.client.nom);
    const pdfUrl = await uploadPDFTemporary(pdfBuffer, nomFichier);
    
    console.log(`[Tool] PDF uploadé: ${pdfUrl}`);
    
    // Envoyer via WhatsApp
    await sendWhatsAppDocument(
      phoneNumber, 
      pdfUrl, 
      nomFichier, 
      `📄 Voici votre devis ${devis.numero}`
    );
    
    console.log('[Tool] Document WhatsApp envoyé');
    
    return { success: true, data: { pdfUrl } };
  } catch (error) {
    console.error('[Tool] generateAndSendDevisPDF error:', error);
    return { success: false, error: `Erreur génération PDF: ${error}` };
  }
}

// ============================================================================
// EXPORT DE TOUS LES TOOLS
// ============================================================================

export const tools = {
  // Clients
  searchClient,
  createClient,
  getClients,
  getClientById,
  
  // Devis
  createDevis,
  getDevis,
  getDevisById,
  updateDevisStatut,
  
  // Factures
  createFacture,
  createFactureFromDevis,
  getFactures,
  getFactureById,
  validateFacture,
  
  // PDF et envoi
  generateAndSendFacturePDF,
  generateAndSendDevisPDF,
  
  // Entreprise
  getEntrepriseSettings,
  updateEntrepriseSettings,
  
  // Utilisateur / Onboarding
  createUserWithEntreprise,
  getConversationState,
  updateConversationState,
};

export type ToolName = keyof typeof tools;
