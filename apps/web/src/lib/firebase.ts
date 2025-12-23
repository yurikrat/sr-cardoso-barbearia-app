import { initializeApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { debugLog } from '@/utils/debugLog';

// Configuração será injetada via variáveis de ambiente
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingFirebaseEnvKeys = [
  !firebaseConfig.apiKey && 'VITE_FIREBASE_API_KEY',
  !firebaseConfig.authDomain && 'VITE_FIREBASE_AUTH_DOMAIN',
  !firebaseConfig.projectId && 'VITE_FIREBASE_PROJECT_ID',
  !firebaseConfig.storageBucket && 'VITE_FIREBASE_STORAGE_BUCKET',
  !firebaseConfig.messagingSenderId && 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  !firebaseConfig.appId && 'VITE_FIREBASE_APP_ID',
].filter(Boolean) as string[];

// #region agent log
debugLog({
  sessionId: 'debug-session',
  runId: 'run3',
  hypothesisId: 'H1',
  location: 'apps/web/src/lib/firebase.ts:firebaseConfig',
  message: 'firebase env presence',
  data: {
    hasApiKey: !!import.meta.env.VITE_FIREBASE_API_KEY,
    hasAuthDomain: !!import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    hasProjectId: !!import.meta.env.VITE_FIREBASE_PROJECT_ID,
    hasStorageBucket: !!import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    hasMessagingSenderId: !!import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    hasAppId: !!import.meta.env.VITE_FIREBASE_APP_ID,
    useEmulator: import.meta.env.VITE_USE_FIREBASE_EMULATOR ?? null,
    missingKeysCount: missingFirebaseEnvKeys.length,
  },
  timestamp: Date.now(),
});
// #endregion

if (missingFirebaseEnvKeys.length > 0) {
  // #region agent log
  debugLog({
    sessionId: 'debug-session',
    runId: 'run3',
    hypothesisId: 'H1',
    location: 'apps/web/src/lib/firebase.ts:firebaseConfig:missingEnv',
    message: 'firebase env missing - blocking init',
    data: { missingKeys: missingFirebaseEnvKeys },
    timestamp: Date.now(),
  });
  // #endregion
  throw new Error(
    `Firebase não configurado. Crie o arquivo apps/web/.env e preencha: ${missingFirebaseEnvKeys.join(
      ', '
    )}`
  );
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);

// Helpers para chamar Functions
export const createBookingFn = httpsCallable(functions, 'createBooking');
export const adminCancelBookingFn = httpsCallable(functions, 'adminCancelBooking');
export const adminRescheduleBookingFn = httpsCallable(functions, 'adminRescheduleBooking');
export const adminBlockSlotsFn = httpsCallable(functions, 'adminBlockSlots');
export const adminMarkWhatsappSentFn = httpsCallable(functions, 'adminMarkWhatsappSent');

