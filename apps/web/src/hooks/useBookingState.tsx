import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
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
  cancelCode: string | null;
}

interface BookingContextType extends BookingState {
  setServiceType: (service: ServiceType | null) => void;
  setBarberId: (barberId: string | null) => void;
  setSelectedDate: (date: Date | null) => void;
  setSelectedSlot: (slot: DateTime | null) => void;
  setCustomerData: (data: CustomerData | null) => void;
  setCancelCode: (cancelCode: string | null) => void;
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
    cancelCode: null,
  });

  const [state, setState] = useState<BookingState>(storedState);

  const updateState = useCallback(
    (updates: Partial<BookingState>) => {
      setState((prev) => {
        const newState = { ...prev, ...updates };
        setStoredState(newState);
        return newState;
      });
    },
    [setStoredState]
  );

  const clearBooking = useCallback(() => {
    const emptyState: BookingState = {
      serviceType: null,
      barberId: null,
      selectedDate: null,
      selectedSlot: null,
      customerData: null,
      cancelCode: null,
    };
    setState(emptyState);
    setStoredState(emptyState);
  }, [setStoredState]);

  const setServiceType = useCallback(
    (service: ServiceType | null) => updateState({ serviceType: service }),
    [updateState]
  );

  const setBarberId = useCallback((barberId: string | null) => updateState({ barberId }), [updateState]);

  const setSelectedDate = useCallback((date: Date | null) => updateState({ selectedDate: date }), [updateState]);

  const setSelectedSlot = useCallback((slot: DateTime | null) => updateState({ selectedSlot: slot }), [updateState]);

  const setCustomerData = useCallback(
    (data: CustomerData | null) => updateState({ customerData: data }),
    [updateState]
  );

  const setCancelCode = useCallback((cancelCode: string | null) => updateState({ cancelCode }), [updateState]);

  const value = useMemo<BookingContextType>(
    () => ({
      ...state,
      setServiceType,
      setBarberId,
      setSelectedDate,
      setSelectedSlot,
      setCustomerData,
      setCancelCode,
      clearBooking,
    }),
    [state, setServiceType, setBarberId, setSelectedDate, setSelectedSlot, setCustomerData, setCancelCode, clearBooking]
  );

  return (
    <BookingContext.Provider value={value}>
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

