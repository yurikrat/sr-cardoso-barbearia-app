/**
 * Script para atualizar telefones dos barbeiros existentes
 * 
 * Uso:
 *   npx tsx scripts/update-barber-phones.ts
 */

import { Firestore } from '@google-cloud/firestore';

const BARBER_PHONES: Record<string, string> = {
  // Username do adminUser -> telefone E164 (formato: +55 DDD 9XXXX-XXXX)
  // Celulares brasileiros agora têm 9 dígitos (9 na frente)
  'sr-cardoso': '+5579996324849',         // +55 79 99632-4849
  'emanuel-fernandes': '+5579998492269',  // +55 79 99849-2269
};

async function main() {
  const db = new Firestore();
  
  for (const [username, phoneE164] of Object.entries(BARBER_PHONES)) {
    const ref = db.collection('adminUsers').doc(username);
    const snap = await ref.get();
    
    if (!snap.exists) {
      console.log(`⚠️  Usuário "${username}" não encontrado`);
      continue;
    }
    
    await ref.update({ phoneE164 });
    console.log(`✓ "${username}" atualizado com telefone ${phoneE164}`);
  }
  
  console.log('\n✅ Concluído!');
}

main().catch(console.error);
