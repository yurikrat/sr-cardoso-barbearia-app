import { createContext, useContext, useState, ReactNode } from 'react';
import { useLocalStorage } from './useLocalStorage';
import type { ServiceType } from '@sr-cardoso/shared';
import { DateTime } from 'luxon';

interface CustomerData {
  firstName: string;
  lastName: string;
  whatsapp: string;
}

interface BookingState {
  serviceType: ServiceType | null;
  barberId: string | null;
  selectedDate: Date | null;
  selectedSlot: DateTime | null;
  customerData: CustomerData | null;
}

interface BookingContextType extends BookingState {
  setServiceType: (service: ServiceType | null) => void;
  setBarberId: (barberId: string | null) => void;
  setSelectedDate: (date: Date | null) => void;
  setSelectedSlot: (slot: DateTime | null) => void;
  setCustomerData: (data: CustomerData | null) => void;
  clearBooking: () => void;
}

const BookingContext = createContext<BookingContextType | undefined>(undefined);

const STORAGE_KEY = 'sr-cardoso-booking-state';

export function BookingProvider({ children }: { children: ReactNode }) {
  const [storedState, setStoredState] = useLocalStorage<BookingState>(STORAGE_KEY, {
    serviceType: null,
    barberId: null,
    selectedDate: null,
    selectedSlot: null,
    customerData: null,
  });

  const [state, setState] = useState<BookingState>(storedState);

  const updateState = (updates: Partial<BookingState>) => {
    const newState = { ...state, ...updates };
    setState(newState);
    setStoredState(newState);
  };

  const clearBooking = () => {
    const emptyState: BookingState = {
      serviceType: null,
      barberId: null,
      selectedDate: null,
      selectedSlot: null,
      customerData: null,
    };
    setState(emptyState);
    setStoredState(emptyState);
  };

  return (
    <BookingContext.Provider
      value={{
        ...state,
        setServiceType: (service) => updateState({ serviceType: service }),
        setBarberId: (barberId) => updateState({ barberId }),
        setSelectedDate: (date) => updateState({ selectedDate: date }),
        setSelectedSlot: (slot) => updateState({ selectedSlot: slot }),
        setCustomerData: (data) => updateState({ customerData: data }),
        clearBooking,
      }}
    >
      {children}
    </BookingContext.Provider>
  );
}

export function useBookingState() {
  const context = useContext(BookingContext);
  if (context === undefined) {
    throw new Error('useBookingState must be used within a BookingProvider');
  }
  return context;
}

