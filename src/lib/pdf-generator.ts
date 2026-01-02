import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import path from 'path';

interface DevisData {
  devis: {
    numero: string;
    date: Date;
    dateValidite: Date;
    lignes: {
      description: string;
      quantite: number;
      prixUnitaireHT: number;
    }[];
    totalHT: number;
    totalTTC: number;
    tauxTVA: number;
    conditionsPaiement: string;
  };
  entreprise: {
    nom: string;
    adresse: string | null;
    siren: string | null;
    tvaIntra: string | null;
    mentionTVALegale: string | null;
  };
  client: {
    nom: string;
    adresse: string | null;
    siren: string | null;
    tvaIntra: string | null;
  };
}

const devisTemplatePath = path.join(process.cwd(), 'templates', 'devis.html');
const devisHtml = readFileSync(devisTemplatePath, 'utf8');
const devisTemplate = Handlebars.compile(devisHtml);

const factureTemplatePath = path.join(process.cwd(), 'templates', 'facture.html');
const factureHtml = readFileSync(factureTemplatePath, 'utf8');
const factureTemplate = Handlebars.compile(factureHtml);

// Helpers Handlebars
Handlebars.registerHelper('formatDate', (date) => {
  return new Date(date).toLocaleDateString('fr-FR');
});
Handlebars.registerHelper('formatMoney', (value) => {
  return Number(value).toFixed(2);
});
Handlebars.registerHelper('multiply', (a, b) => a * b);
Handlebars.registerHelper('eq', (a, b) => a === b);

export async function genererDevisPDF(data: DevisData): Promise<Buffer> {
  const html = devisTemplate(data);

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
  });

  await browser.close();
  return Buffer.from(pdfBuffer);
}

interface FactureData {
  facture: {
    numero: string;
    dateEmission: Date;
    estValidee: boolean;
    lignes: {
      description: string;
      quantite: number;
      prixUnitaireHT: number;
      tauxTVA: number;
    }[];
    totalHT: number;
    totalTVA: number;
    totalTTC: number;
    tauxTVA: number;
    conditionsPaiement: string;
  };
  entreprise: {
    nom: string;
    adresse: string | null;
    codePostal: string | null;
    ville: string | null;
    siren: string | null;
    tvaIntra: string | null;
    iban: string | null;
    bic: string | null;
    regimeTVA: string;
    mentionTVALegale: string | null;
    mentionsLegales: string | null;
  };
  client: {
    nom: string;
    adresse: string | null;
    siren: string | null;
    tvaIntra: string | null;
  };
}

export async function genererFacturePDF(data: FactureData): Promise<Buffer> {
  const html = factureTemplate(data);

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
  });

  await browser.close();
  return Buffer.from(pdfBuffer);
}