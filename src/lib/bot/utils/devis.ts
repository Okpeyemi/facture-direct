// src/lib/bot/utils/devis.ts

import { prisma } from '@/lib/prisma';
import { put } from '@vercel/blob';

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
    });

    console.log(`[Upload] PDF uploadé avec succès: ${blob.url}`);
    return blob.url;
  } catch (error) {
    console.error('[Upload] Erreur lors de l\'upload du PDF:', error);
    throw new Error(`Échec de l'upload du PDF: ${error}`);
  }
}