import { RegimeTVA } from '@prisma/client';

export interface OnboardingData {
  nomEntreprise?: string;
  adresse?: string;
  siren?: string;
  regimeTVA?: RegimeTVA;
  phraseSecrete?: string;
  history?: string[];
}

export type ExtractedData = {
  nomEntreprise?: string | null;
  adresse?: string | null;
  siren?: string | null;
  regimeTVA?: RegimeTVA | null;
};