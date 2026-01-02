// src/lib/bot/utils/devis.ts

import { prisma } from '@/lib/prisma';
import { put, del } from '@vercel/blob';

export async function genererNumeroDevis(entrepriseId: string): Promise<string> {
  const annee = new Date().getFullYear();
  const dernier = await prisma.devis.findFirst({
    where: { entrepriseId, numero: { startsWith: `DEV-${annee}-` } },
    orderBy: { numero: 'desc' },
  });

  const seq = dernier ? parseInt(dernier.numero.split('-').pop()!) + 1 : 1;
  return `DEV-${annee}-${seq.toString().padStart(3, '0')}`;
}

/**
 * Upload un PDF sur Vercel Blob et retourne l'URL publique.
 * L'URL est accessible publiquement pour être envoyée via WhatsApp.
 */
export async function uploadPDFTemporary(buffer: Buffer, filename: string): Promise<string> {
  try {
    console.log(`[Upload] Début upload PDF: ${filename}`);
    
    const blob = await put(filename, buffer, {
      access: 'public',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    console.log(`[Upload] PDF uploadé avec succès: ${blob.url}`);
    return blob.url;
  } catch (error) {
    console.error('[Upload] Erreur lors de l\'upload du PDF:', error);
    throw new Error(`Échec de l'upload du PDF: ${error}`);
  }
}

/**
 * Supprime un PDF de Vercel Blob par son URL.
 */
export async function deletePDF(url: string): Promise<void> {
  try {
    await del(url);
    console.log(`[Upload] PDF supprimé: ${url}`);
  } catch (error) {
    console.warn(`[Upload] Impossible de supprimer le PDF: ${url}`, error);
  }
}

/**
 * Nettoie un nom pour l'utiliser dans un nom de fichier.
 */
function cleanName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Enlever accents
    .replace(/[^a-zA-Z0-9]/g, '-')   // Remplacer caractères spéciaux par -
    .replace(/-+/g, '-')             // Remplacer -- par -
    .replace(/^-|-$/g, '');          // Enlever - au début/fin
}

/**
 * Génère le nom de fichier PDF pour une facture selon la nomenclature.
 * Brouillon: facture-FACT-xxxx-NomClient-brouillon-annee.pdf
 * Définitive: facture-FACT-xxxx-NomClient-annee.pdf
 */
export function genererNomFichierFacture(
  numero: string,
  clientNom: string,
  estBrouillon: boolean
): string {
  const clientClean = cleanName(clientNom);
  const annee = new Date().getFullYear();
  
  if (estBrouillon) {
    return `facture-${numero}-${clientClean}-brouillon-${annee}.pdf`;
  } else {
    return `facture-${numero}-${clientClean}-${annee}.pdf`;
  }
}

/**
 * Génère le nom de fichier PDF pour un devis selon la nomenclature.
 * Format: devis-DEV-xxxx-NomClient-annee.pdf
 */
export function genererNomFichierDevis(
  numero: string,
  clientNom: string
): string {
  const clientClean = cleanName(clientNom);
  const annee = new Date().getFullYear();
  return `devis-${numero}-${clientClean}-${annee}.pdf`;
}

/**
 * Envoie une notification d'erreur au support.
 * En production, ceci enverrait un email.
 */
export async function notifierErreurSupport(
  erreur: Error | string,
  contexte: {
    utilisateurId?: string;
    telephone?: string;
    etape?: string;
    action?: string;
  }
): Promise<void> {
  const message = typeof erreur === 'string' ? erreur : erreur.message;
  const stack = typeof erreur === 'string' ? '' : erreur.stack;

  console.error('=== ERREUR À NOTIFIER AU SUPPORT ===');
  console.error('Message:', message);
  console.error('Stack:', stack);
  console.error('Contexte:', JSON.stringify(contexte, null, 2));
  console.error('====================================');

  // TODO: Implémenter l'envoi d'email
  // Exemple avec Resend, SendGrid, ou autre service
  // await sendEmail({
  //   to: 'support@facturedirect.com',
  //   subject: `[FactureDirect] Erreur - ${contexte.action || 'Inconnue'}`,
  //   body: `
  //     Erreur: ${message}
  //     Utilisateur: ${contexte.telephone || 'N/A'}
  //     Étape: ${contexte.etape || 'N/A'}
  //     Stack: ${stack}
  //   `
  // });
}