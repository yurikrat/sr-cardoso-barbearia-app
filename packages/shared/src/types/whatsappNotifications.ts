/**
 * Configurações de notificações automáticas via WhatsApp
 */

export interface WhatsAppNotificationSettings {
  // Confirmação de agendamento
  confirmationEnabled: boolean;
  confirmationMessage: string; // Texto personalizado pelo admin (sem placeholders técnicos)

  // Lembrete antes do atendimento
  reminderEnabled: boolean;
  reminderMinutesBefore: number; // Padrão: 60 (1 hora)
  reminderMessage: string;

  // Mensagem de cancelamento
  cancellationMessage: string;

  updatedAt?: Date;
  updatedBy?: string;
}

export const DEFAULT_NOTIFICATION_SETTINGS: WhatsAppNotificationSettings = {
  confirmationEnabled: true,
  confirmationMessage:
    'Tudo certo! Seu horário está reservado. Chega uns 5 minutinhos antes pra gente te atender com calma.',
  reminderEnabled: true,
  reminderMinutesBefore: 60,
  reminderMessage:
    'Falta pouco pro seu horário! Te vejo daqui a pouco aqui na barbearia.',
  cancellationMessage:
    'Cancelado! Quando quiser reagendar, é só clicar no link abaixo. Vai ser um prazer te atender.',
};

/**
 * Fila de retry para mensagens que falharam
 */
export type MessageType = 'confirmation' | 'reminder' | 'cancellation';

export interface WhatsAppMessageQueue {
  id: string;
  bookingId: string;
  customerId: string;
  phoneE164: string;
  messageType: MessageType;
  messageText: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: Date;
  lastError?: string;
  createdAt: Date;
  sentAt?: Date;
}
