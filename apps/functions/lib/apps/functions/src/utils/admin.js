"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireBarberOrOwner = requireBarberOrOwner;
const functions = __importStar(require("firebase-functions"));
/**
 * Verifica se o usuário está autenticado e é admin
 */
function requireAuth(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado');
    }
}
/**
 * Verifica se o usuário tem role de barbeiro ou owner
 */
function requireBarberOrOwner(context, barberId) {
    requireAuth(context);
    const claims = context.auth.token;
    // Se tem role owner, pode tudo
    if (claims.role === 'owner') {
        return;
    }
    // Se tem role barber, só pode acessar própria agenda
    if (claims.role === 'barber') {
        if (barberId && claims.barberId !== barberId) {
            throw new functions.https.HttpsError('permission-denied', 'Você só pode gerenciar sua própria agenda');
        }
        return;
    }
    throw new functions.https.HttpsError('permission-denied', 'Acesso negado. Apenas barbeiros e administradores podem acessar.');
}
//# sourceMappingURL=admin.js.map