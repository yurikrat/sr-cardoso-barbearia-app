/**
 * Script de migração para popular o campo profile.birthdayMmdd
 * para clientes que têm profile.birthday mas não têm birthdayMmdd
 * 
 * Execute: npx tsx scripts/migrate-birthdayMmdd.ts
 */

import { Firestore, Timestamp } from '@google-cloud/firestore';

// Inicializa Firestore (usa GOOGLE_APPLICATION_CREDENTIALS automaticamente)
const projectId = process.env.GCP_PROJECT_ID || 'sr-cardoso-barbearia-prd';
const db = new Firestore({ projectId });

console.log(`🔌 Conectando ao projeto: ${projectId}`);

/**
 * Converte uma data ISO ou timestamp para formato MMDD
 * Usa Date() para manter consistência com como o frontend salva
 */
function extractMmdd(birthday: unknown): string | null {
  if (!birthday) return null;
  
  try {
    let date: Date;
    
    if (typeof birthday === 'string') {
      date = new Date(birthday);
    } else if (birthday instanceof Timestamp) {
      date = birthday.toDate();
    } else if (typeof birthday === 'object' && birthday !== null && 'seconds' in birthday) {
      date = new Date((birthday as { seconds: number }).seconds * 1000);
    } else {
      return null;
    }
    
    if (isNaN(date.getTime())) return null;
    
    // Usa getMonth/getDate local (consistente com como o frontend salva)
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}${day}`;
  } catch {
    return null;
  }
}

async function migrateCustomers() {
  console.log('🔍 Re-migrando todos os clientes com birthday...\n');
  
  const customersSnap = await db.collection('customers').get();
  
  let total = 0;
  let migrated = 0;
  let unchanged = 0;
  let noBirthday = 0;
  let errors = 0;
  
  const batch = db.batch();
  let batchCount = 0;
  
  for (const doc of customersSnap.docs) {
    total++;
    const data = doc.data();
    const profile = data.profile || {};
    const identity = data.identity || {};
    
    const name = `${identity.firstName || ''} ${identity.lastName || ''}`.trim() || doc.id;
    
    // Tem birthday para migrar?
    if (!profile.birthday) {
      noBirthday++;
      continue;
    }
    
    const mmdd = extractMmdd(profile.birthday);
    
    if (!mmdd) {
      console.log(`⚠️  ${name}: birthday inválido (${profile.birthday})`);
      errors++;
      continue;
    }
    
    // Se já tem o valor correto, pula
    if (profile.birthdayMmdd === mmdd) {
      unchanged++;
      continue;
    }
    
    const oldValue = profile.birthdayMmdd || '(vazio)';
    console.log(`✓ ${name}: ${profile.birthday} → ${mmdd} (era: ${oldValue})`);
    
    batch.update(doc.ref, {
      'profile.birthdayMmdd': mmdd
    });
    
    migrated++;
    batchCount++;
    
    // Commit a cada 500 documentos (limite do Firestore)
    if (batchCount >= 400) {
      console.log('\n📦 Commitando batch...');
      await batch.commit();
      console.log('✓ Batch commitado\n');
      batchCount = 0;
    }
  }
  
  // Commit final
  if (batchCount > 0) {
    console.log('\n📦 Commitando batch final...');
    await batch.commit();
    console.log('✓ Batch commitado');
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 Resumo da migração:');
  console.log('='.repeat(50));
  console.log(`Total de clientes:        ${total}`);
  console.log(`Já estavam corretos:      ${unchanged}`);
  console.log(`Sem birthday:             ${noBirthday}`);
  console.log(`Corrigidos:               ${migrated}`);
  console.log(`Erros:                    ${errors}`);
  console.log('='.repeat(50));
  
  if (migrated > 0) {
    console.log('\n✅ Migração concluída com sucesso!');
  } else {
    console.log('\n✅ Nenhum cliente precisou de migração.');
  }
  
  process.exit(0);
}

migrateCustomers().catch((error) => {
  console.error('❌ Erro na migração:', error);
  process.exit(1);
});
