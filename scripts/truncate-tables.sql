-- Désactiver temporairement les contraintes de clé étrangère
SET session_replication_role = 'replica';

-- Vider toutes les tables dans l'ordre inverse des dépendances
TRUNCATE TABLE "public"."ConversationState" CASCADE;
TRUNCATE TABLE "public"."LigneFacture" CASCADE;
TRUNCATE TABLE "public"."Facture" CASCADE;
TRUNCATE TABLE "public"."LigneDevis" CASCADE;
TRUNCATE TABLE "public"."Devis" CASCADE;
TRUNCATE TABLE "public"."Client" CASCADE;
TRUNCATE TABLE "public"."Utilisateur" CASCADE;
TRUNCATE TABLE "public"."Entreprise" CASCADE;

-- Réactiver les contraintes de clé étrangère
SET session_replication_role = 'origin';
