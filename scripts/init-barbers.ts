/**
 * Script para inicializar os barbeiros no Firestore
 * Execute: npx tsx scripts/init-barbers.ts
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

// Inicializar Firebase Admin
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT_PATH não definido');
  console.log('💡 Crie uma service account no Firebase Console e defina o caminho:');
  console.log('   export FIREBASE_SERVICE_ACCOUNT_PATH=./path/to/serviceAccountKey.json');
  process.exit(1);
}

try {
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (error) {
  console.error('❌ Erro ao inicializar Firebase Admin:', error);
  process.exit(1);
}

const db = admin.firestore();

const BARBERS = [
  {
    id: 'sr-cardoso',
    name: 'Sr Cardoso',
    active: true,
  },
  {
    id: 'emanuel-fernandes',
    name: 'Emanuel Fernandes',
    active: true,
  },
];

async function initBarbers() {
  console.log('🚀 Inicializando barbeiros no Firestore...\n');

  for (const barber of BARBERS) {
    try {
      const barberRef = db.collection('barbers').doc(barber.id);
      const barberDoc = await barberRef.get();

      if (barberDoc.exists) {
        const existingData = barberDoc.data()!;
        console.log(`✓ ${barber.name} já existe`);
        
        // Gerar token se não existir
        if (!existingData.calendarFeedToken) {
          const token = randomBytes(32).toString('hex');
          await barberRef.update({ calendarFeedToken: token });
          console.log(`  → Token de calendário gerado`);
        }
      } else {
        // Criar novo barbeiro
        const token = randomBytes(32).toString('hex');
        await barberRef.set({
          name: barber.name,
          active: barber.active,
          calendarFeedToken: token,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`✓ ${barber.name} criado`);
        console.log(`  → Token de calendário: ${token}`);
      }
    } catch (error) {
      console.error(`❌ Erro ao processar ${barber.name}:`, error);
    }
  }

  console.log('\n✅ Concluído!');
  process.exit(0);
}

initBarbers();

