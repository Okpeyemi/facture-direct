# FactureDirect

**FactureDirect** est un logiciel de facturation et devis 100% conversationnel accessible uniquement via WhatsApp.
Aucun login, aucune application à installer, aucune interface web : tout se passe par message texte ou vocal.

Idéal pour les freelances, auto-entrepreneurs, artisans et TPE qui veulent facturer en 30 secondes sans complication.

## Fonctionnalités

### Implémentées
- **Onboarding automatique** : Configuration de l'entreprise (nom, adresse, régime TVA, etc.) via conversation à la première utilisation.
- **Création de devis** : Conversation naturelle pour créer des devis, avec gestion des clients, lignes de devis, validité, et génération de PDF envoyé directement sur WhatsApp.
- **Gestion des clients** : Création et mise à jour des clients via conversation.
- **Génération PDF professionnelle** : PDFs de devis générés avec Handlebars et Puppeteer, envoyés sur WhatsApp.
- **Transcription vocale** : Support des messages vocaux via OpenAI Whisper.
- **États de conversation** : Gestion des états de conversation et brouillons multi-utilisateurs avec DevisDraft.
- **Numérotation automatique** : Numéros de devis générés automatiquement.

### En développement
- Création de factures par conversation naturelle (texte ou message vocal).
- États facture : brouillon → validée (immuable une fois validée).
- Création d'avoirs pour corriger ou annuler une facture validée.
- Numérotation séquentielle stricte et inaltérabilité (conforme loi anti-fraude TVA).
- Gestion intelligente de la TVA selon régime (franchise en base, assujetti classique, association, outre-mer, etc.).
- Multi-utilisateurs avec rôles (Admin, Comptable, Commercial, Consultation).
- Abonnements SaaS (Free, Starter, Pro, Enterprise) avec limites personnalisées.
- Recherche intelligente de factures/devis (par client, date, montant).

## Stack technique

- **Framework** : Next.js 16.1.1 (App Router) – backend uniquement (serverless).
- **Langage** : TypeScript.
- **Base de données** : PostgreSQL + Prisma ORM (v7.2.0).
- **Intégration WhatsApp** : Twilio (API WhatsApp Business).
- **Transcription vocale** : OpenAI Whisper.
- **Génération PDF** : Handlebars + Puppeteer-core + @sparticuz/chromium (compatible Vercel).
- **Hébergement** : Vercel.
- **Base de données** : Neon / Railway / Supabase (PostgreSQL).
- **Autres** : bcrypt pour hashage, Axios pour requêtes HTTP.

## Prérequis

- Node.js ≥ 18.
- Compte Twilio avec WhatsApp Business API activée.
- Numéro WhatsApp Business vérifié.
- Base de données PostgreSQL (locale ou cloud).
- Clé OpenAI (pour transcription vocale).

## Installation locale

1. **Clonez le repository** :
   ```bash
   git clone https://github.com/rai-rmg/facture-direct.git
   cd facture-direct
   ```

2. **Installez les dépendances** :
   ```bash
   npm install
   ```

3. **Configurez la base de données** :
   - Créez une base PostgreSQL (locale ou via Neon/Railway/Supabase).
   - Copiez `.env.example` vers `.env.local` et remplissez les variables :
     ```
     DATABASE_URL="postgresql://user:password@localhost:5432/facture_direct"
     TWILIO_ACCOUNT_SID="your_twilio_sid"
     TWILIO_AUTH_TOKEN="your_twilio_token"
     TWILIO_WHATSAPP_NUMBER="whatsapp:+1234567890"
     OPENAI_API_KEY="your_openai_key"
     ```

4. **Exécutez les migrations Prisma** :
   ```bash
   npx prisma migrate dev
   ```

5. **Générez le client Prisma** :
   ```bash
   npx prisma generate
   ```

6. **Démarrez le serveur de développement** :
   ```bash
   npm run dev
   ```

7. **Configurez le webhook Twilio** :
   - Dans votre console Twilio, configurez le webhook pour WhatsApp sur `https://votre-domaine.vercel.app/api/whatsapp/webhook` (ou local avec ngrok pour tests).

## Utilisation

- Envoyez un message sur WhatsApp au numéro configuré.
- Suivez les instructions conversationnelles pour l'onboarding et la création de devis.
- Les PDFs sont automatiquement générés et envoyés.

## Scripts npm

- `npm run dev` : Démarre le serveur de développement.
- `npm run build` : Construit l'application pour la production.
- `npm run start` : Démarre le serveur en mode production.
- `npm run lint` : Exécute le linter ESLint.
- `npm run reset-db` : Réinitialise la base de données et applique toutes les migrations (utilisez avec prudence en développement).

## État du projet

Le projet est en développement actif. La création de devis est entièrement fonctionnelle. La création de factures et les fonctionnalités avancées (abonnements, multi-utilisateurs) sont en cours d'implémentation.

## Contribution

Contributions bienvenues ! Ouvrez une issue ou une PR sur GitHub.

## Licence

[MIT](LICENSE)