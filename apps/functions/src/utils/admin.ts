import * as functions from 'firebase-functions';

/**
 * Verifica se o usuário está autenticado e é admin
 */
export function requireAuth(context: functions.https.CallableContext): void {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Usuário não autenticado'
    );
  }
}

/**
 * Verifica se o usuário tem role de barbeiro ou owner
 */
export function requireBarberOrOwner(
  context: functions.https.CallableContext,
  barberId?: string
): void {
  requireAuth(context);
  
  const claims = context.auth!.token;
  
  // Se tem role owner, pode tudo
  if (claims.role === 'owner') {
    return;
  }
  
  // Se tem role barber, só pode acessar própria agenda
  if (claims.role === 'barber') {
    if (barberId && claims.barberId !== barberId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Você só pode gerenciar sua própria agenda'
      );
    }
    return;
  }
  
  throw new functions.https.HttpsError(
    'permission-denied',
    'Acesso negado. Apenas barbeiros e administradores podem acessar.'
  );
}

