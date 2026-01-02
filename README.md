# FactureDirect

**FactureDirect** est un logiciel de facturation et devis 100% conversationnel accessible uniquement via WhatsApp.
Aucun login, aucune application à installer, aucune interface web : tout se passe par message texte ou vocal.

Idéal pour les freelances, auto-entrepreneurs, artisans et TPE qui veulent facturer en 30 secondes sans complication.

## Fonctionnalités

### Implémentées
- **Onboarding automatique** : Configuration de l'entreprise (nom, adresse, régime TVA, IBAN, etc.) via conversation à la première utilisation.
- **Création de devis** : Conversation naturelle pour créer des devis, avec gestion des clients, lignes, validité, et génération de PDF.
- **Création de factures** : Transformation de devis en factures avec workflow conversationnel.
- **Gestion des statuts** : Devis (brouillon → accepté/refusé), Factures (brouillon → validée → payée).
- **Validation de factures** : Une fois validée, la facture est définitive et le PDF définitif est généré.
- **Gestion des clients** : Création et sélection des clients via conversation.
- **Génération PDF professionnelle** : PDFs A4 générés avec Handlebars et Puppeteer, envoyés directement sur WhatsApp.
- **Nomenclature PDF** :
  - Devis : `devis-DEV-xxxx-NomClient-annee.pdf`
  - Facture brouillon : `facture-FACT-xxxx-NomClient-brouillon-annee.pdf`
  - Facture validée : `facture-FACT-xxxx-NomClient-annee.pdf`
- **Transcription vocale** : Support des messages vocaux via OpenAI Whisper.
- **Commandes conversationnelles** :
  - `menu` : Affiche le menu principal
  - `mes devis` / `mes factures` : Liste les documents
  - `1`, `2`, `3`... : Sélectionne un devis pour voir ses détails
  - `facturer` : Crée une facture depuis un devis
  - `valider` : Valide une facture brouillon
  - `imprimer` / `imprimer devis` : Génère le PDF
  - `statut` : Affiche l'état de l'opération en cours
  - `annuler` : Annule l'opération en cours
- **États de conversation** : Gestion des brouillons multi-utilisateurs (DevisDraft, FactureDraft).
- **Numérotation automatique** : DEV-AAAA-XXX pour devis, FACT-AAAA-XXX pour factures.
- **Paramètres entreprise** : Consultation des informations de l'entreprise.

### En développement
- Modification de devis existants.
- Création d'avoirs pour corriger ou annuler une facture validée.
- Numérotation séquentielle stricte et inaltérabilité (conforme loi anti-fraude TVA).
- Gestion intelligente de la TVA selon régime (franchise en base, assujetti classique, etc.).
- Multi-utilisateurs avec rôles (Admin, Comptable, Commercial, Consultation).
- Abonnements SaaS (Free, Starter, Pro, Enterprise) avec limites personnalisées.
- Recherche intelligente de factures/devis (par client, date, montant).
- Notifications d'erreurs par email au support.

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
     BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxx
     TWILIO_ACCOUNT_SID=your_account_id
     TWILIO_AUTH_TOKEN=your_permanent_token
     TWILIO_WHATSAPP_NUMBER=whatsapp:+1234567890
     GROQ_API_KEY=your_groq_api_key
     GROQ_MODEL_VALIDATION=llama3-8b-8192
     GROQ_MODEL_MAIN=llama3-8b-8192
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

1. Envoyez un message sur WhatsApp au numéro configuré.
2. Suivez les instructions conversationnelles pour l'onboarding (première utilisation).
3. Tapez `menu` pour voir les options disponibles.
4. Créez un devis en tapant "Créer un devis".
5. Transformez un devis en facture en tapant "Créer une facture" puis sélectionnez le devis.
6. Validez une facture brouillon en tapant `valider`.
7. Les PDFs sont automatiquement générés et envoyés sur WhatsApp.

## Scripts npm

- `npm run dev` : Démarre le serveur de développement.
- `npm run build` : Construit l'application pour la production.
- `npm run start` : Démarre le serveur en mode production.
- `npm run lint` : Exécute le linter ESLint.
- `npm run reset-db` : Réinitialise la base de données et applique toutes les migrations (utilisez avec prudence en développement).

## État du projet

Le projet est en développement actif. Les fonctionnalités principales sont opérationnelles :
- ✅ Onboarding complet
- ✅ Création et gestion de devis
- ✅ Création de factures depuis devis
- ✅ Validation de factures avec génération PDF définitif
- ✅ Consultation des listes (devis, factures)
- ✅ Génération PDF A4 professionnels
- 🚧 Modification de devis
- 🚧 Avoirs et conformité anti-fraude TVA

## Contribution

Contributions bienvenues ! Ouvrez une issue ou une PR sur GitHub.

## Licence

[MIT](LICENSE)