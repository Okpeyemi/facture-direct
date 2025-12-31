import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import type { OnboardingData } from './types';

// Création finale de l'utilisateur et entreprise
export async function createUserAndCompany(phone: string, data: OnboardingData): Promise<void> {
  if (!data.phraseSecrete) throw new Error('Phrase secrète manquante');
  const hashedPhrase = await bcrypt.hash(data.phraseSecrete, 10);

  // Créer l'entreprise
  const entreprise = await prisma.entreprise.create({
    data: {
      nom: data.nomEntreprise!,
      adresse: data.adresse,
      siren: data.siren,
      regimeTVA: data.regimeTVA,
      phraseSecreteHash: hashedPhrase,
    },
  });

  // Créer l'utilisateur (rôle par défaut : ADMIN pour le premier)
  await prisma.utilisateur.create({
    data: {
      telephone: phone,
      nom: 'Admin', // Nom par défaut, peut être modifié plus tard
      entrepriseId: entreprise.id,
      role: 'ADMIN',
    },
  });
}