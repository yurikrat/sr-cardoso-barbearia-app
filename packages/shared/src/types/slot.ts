export type SlotKind = 'booking' | 'block';

export interface Slot {
  id: string; // YYYYMMDD_HHmm
  slotStart: Date;
  dateKey: string; // YYYY-MM-DD
  kind: SlotKind;
  bookingId?: string;
  bookingIds?: string[];
  reason?: string; // Para blocks
  createdAt: Date;
  updatedAt: Date;
}

