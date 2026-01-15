export interface CustomerIdentity {
  firstName: string;
  lastName: string;
  whatsappE164: string;
}

export interface CustomerProfile {
  birthday?: string; // YYYY-MM-DD
  birthdayMmdd?: string; // MMDD
  notes?: string;
  tags?: string[];
}

export interface CustomerConsent {
  marketingOptIn: boolean;
  marketingOptInAt?: Date;
  marketingOptOutAt?: Date;
}

export interface CustomerStats {
  firstBookingAt?: Date;
  lastBookingAt?: Date;
  lastCompletedAt?: Date;
  totalBookings: number;
  totalCompleted: number;
  noShowCount: number;
  lastContactAt?: Date;
  totalPurchases?: number;
  totalSpentCents?: number;
  lastPurchaseAt?: Date;
}

export interface Customer {
  id: string;
  identity: CustomerIdentity;
  profile: CustomerProfile;
  consent: CustomerConsent;
  stats: CustomerStats;
}

