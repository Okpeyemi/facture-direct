# FactureDirect

**FactureDirect** est un logiciel de facturation et devis 100% conversationnel accessible uniquement via WhatsApp.  
Aucun login, aucune application à installer, aucune interface web : tout se passe par message texte ou vocal.

Idéal pour les freelances, auto-entrepreneurs, artisans et TPE qui veulent facturer en 30 secondes sans complication.

## Fonctionnalités

- Création de devis et factures par conversation naturelle (texte ou message vocal)
- Gestion complète des clients
- États facture : brouillon → validée (immuable une fois validée)
- Création d’avoirs pour corriger ou annuler une facture validée
- Numérotation séquentielle stricte et inaltérabilité (conforme loi anti-fraude TVA)
- Gestion intelligente de la TVA selon régime (franchise en base, assujetti classique, association, outre-mer, etc.)
- Multi-utilisateurs avec rôles (Admin, Comptable, Commercial, Consultation)
- Abonnements SaaS (Free, Starter, Pro, Enterprise) avec limites personnalisées
- Recherche intelligente de factures/devis (par client, date, montant)
- Génération PDF professionnelle et envoi direct dans WhatsApp
- Onboarding automatique à la première utilisation

## Stack technique

- **Framework** : Next.js 14+ (App Router) – backend uniquement (serverless)
- **Langage** : TypeScript
- **Base de données** : PostgreSQL + Prisma ORM
- **Intégration WhatsApp** : Meta WhatsApp Cloud API (officielle)
- **Transcription vocale** : OpenAI Whisper
- **Génération PDF** : Handlebars + Puppeteer-core + @sparticuz/chromium (compatible Vercel)
- **Hébergement** : Vercel
- **Base de données** : Neon / Railway / Supabase (PostgreSQL)

## Prérequis

- Node.js ≥ 18
- Compte Meta for Developers avec WhatsApp Business API activée
- Numéro WhatsApp Business vérifié
- Base de données PostgreSQL
- Clé OpenAI (pour transcription vocale)

## Installation locale

```bash
git clone https://github.com/ton-pseudo/facturedirect.git
cd facturedirect
npm install