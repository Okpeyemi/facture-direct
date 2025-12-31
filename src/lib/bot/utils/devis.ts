// src/lib/bot/utils/devis.ts

import { prisma } from '@/lib/prisma';

export async function genererNumeroDevis(entrepriseId: string): Promise<string> {
  const annee = new Date().getFullYear();
  const dernier = await prisma.devis.findFirst({
    where: { entrepriseId, numero: { startsWith: `DEV-${annee}-` } },
    orderBy: { numero: 'desc' },
  });

  const seq = dernier ? parseInt(dernier.numero.split('-').pop()!) + 1 : 1;
  return `DEV-${annee}-${seq.toString().padStart(3, '0')}`;
}

export async function uploadPDFTemporary(buffer: Buffer, filename: string): Promise<string> {
  // Placeholder – à remplacer par Vercel Blob ou autre
  console.warn('Upload PDF temporaire non implémenté – utilisation placeholder');
  return `https://example.com/temp/${filename}`;
}