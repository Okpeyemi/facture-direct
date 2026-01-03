// scripts/reset-db.ts
// Script pour réinitialiser la base de données
// Usage: npx tsx scripts/reset-db.ts

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetDatabase() {
  console.log('🗑️  Réinitialisation de la base de données...\n');

  try {
    // Supprimer dans l'ordre pour respecter les contraintes de clé étrangère
    
    console.log('Suppression des états de conversation...');
    const convDeleted = await prisma.conversationState.deleteMany();
    console.log(`  ✓ ${convDeleted.count} états supprimés`);

    console.log('Suppression des lignes de factures...');
    const lignesFactureDeleted = await prisma.ligneFacture.deleteMany();
    console.log(`  ✓ ${lignesFactureDeleted.count} lignes supprimées`);

    console.log('Suppression des factures...');
    const facturesDeleted = await prisma.facture.deleteMany();
    console.log(`  ✓ ${facturesDeleted.count} factures supprimées`);

    console.log('Suppression des lignes de devis...');
    const lignesDevisDeleted = await prisma.ligneDevis.deleteMany();
    console.log(`  ✓ ${lignesDevisDeleted.count} lignes supprimées`);

    console.log('Suppression des devis...');
    const devisDeleted = await prisma.devis.deleteMany();
    console.log(`  ✓ ${devisDeleted.count} devis supprimés`);

    console.log('Suppression des clients...');
    const clientsDeleted = await prisma.client.deleteMany();
    console.log(`  ✓ ${clientsDeleted.count} clients supprimés`);

    console.log('Suppression des utilisateurs...');
    const usersDeleted = await prisma.utilisateur.deleteMany();
    console.log(`  ✓ ${usersDeleted.count} utilisateurs supprimés`);

    console.log('Suppression des entreprises...');
    const entreprisesDeleted = await prisma.entreprise.deleteMany();
    console.log(`  ✓ ${entreprisesDeleted.count} entreprises supprimées`);

    console.log('\n✅ Base de données réinitialisée avec succès !');
    
  } catch (error) {
    console.error('❌ Erreur lors de la réinitialisation:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Demander confirmation
const args = process.argv.slice(2);
if (args.includes('--force') || args.includes('-f')) {
  resetDatabase();
} else {
  console.log('⚠️  ATTENTION: Ce script va SUPPRIMER TOUTES LES DONNÉES !');
  console.log('');
  console.log('Pour confirmer, relancez avec --force ou -f :');
  console.log('  npx tsx scripts/reset-db.ts --force');
  console.log('');
  process.exit(0);
}
