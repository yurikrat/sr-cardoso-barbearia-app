import { z } from 'zod';

export const adminWhatsappStatusResponseSchema = z.object({
  instanceName: z.string(),
  instanceExists: z.boolean(),
  connectionState: z.string().nullable(),
  checkedBy: z.enum(['connectionState', 'fetchInstances', 'unknown']),
  hint: z.string().optional(),
  configured: z.boolean().optional(),
  missing: z.array(z.enum(['EVOLUTION_BASE_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE_NAME'])).optional(),
});

export type AdminWhatsappStatusResponse = z.infer<typeof adminWhatsappStatusResponseSchema>;

export const adminWhatsappConnectResponseSchema = z.object({
  instanceName: z.string().min(1),
  qrcodeBase64: z.string().nullable(),
  pairingCode: z.string().nullable().optional(),
});

export type AdminWhatsappConnectResponse = z.infer<typeof adminWhatsappConnectResponseSchema>;

export const adminWhatsappConnectRequestSchema = z
  .object({
    mode: z.enum(['qr', 'pairingCode']).optional(),
    phoneNumber: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    const mode = val.mode ?? 'qr';
    if (mode === 'pairingCode') {
      if (!val.phoneNumber || !val.phoneNumber.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phoneNumber'],
          message: 'phoneNumber é obrigatório para pairingCode',
        });
      }
    }
  });

export type AdminWhatsappConnectRequest = z.infer<typeof adminWhatsappConnectRequestSchema>;

export const adminWhatsappSendTestRequestSchema = z.object({
  toE164: z.string().min(8),
  text: z.string().min(1).max(2000),
});

export type AdminWhatsappSendTestRequest = z.infer<typeof adminWhatsappSendTestRequestSchema>;

export const adminWhatsappSendTestResponseSchema = z.object({
  success: z.boolean(),
  deduped: z.boolean().optional(),
});

export type AdminWhatsappSendTestResponse = z.infer<typeof adminWhatsappSendTestResponseSchema>;

export const adminWhatsappSendConfirmationRequestSchema = z.object({
  text: z.string().min(1).max(2000),
});

export type AdminWhatsappSendConfirmationRequest = z.infer<typeof adminWhatsappSendConfirmationRequestSchema>;

export const adminWhatsappSendConfirmationResponseSchema = z.object({
  success: z.boolean(),
  deduped: z.boolean().optional(),
});

export type AdminWhatsappSendConfirmationResponse = z.infer<typeof adminWhatsappSendConfirmationResponseSchema>;
