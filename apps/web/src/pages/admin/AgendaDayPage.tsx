import { useMemo, useState, useEffect, useRef, type ChangeEvent } from 'react';
import { api } from '@/lib/api';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { BlockSlotsModal } from '@/components/admin/BlockSlotsModal';
import { CreateBookingModal } from '@/components/admin/CreateBookingModal';
import { SaleModal } from '@/components/admin/SaleModal';
import { formatTime } from '@/utils/dates';
import { DateTime } from 'luxon';
import { useToast } from '@/components/ui/use-toast';
import { adminCancelBookingFn } from '@/lib/api-compat';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, LayoutGrid, Columns, List, Plus, Lock, Unlock, Package, Minus, ShoppingCart } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useSearchParams } from 'react-router-dom';
import { SERVICE_LABELS, ADMIN_TIME_SLOTS } from '@/utils/constants';
import { cn } from '@/lib/utils';
import { useAdminAutoRefreshToken } from '@/contexts/AdminAutoRefreshContext';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import type { PaymentMethod } from '@sr-cardoso/shared';

// Tipo local para produtos do checkout (baseado no retorno da API)
type CheckoutProduct = Awaited<ReturnType<typeof api.admin.listProducts>>[number];

// Labels para formas de pagamento (mantido em sincronia com packages/shared)
const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  credit: 'Cartão de Crédito',
  debit: 'Cartão de Débito',
  cash: 'Dinheiro',
  pix: 'Pix',
};

interface Booking {
  id: string;
  barberId?: string;
  customer: { firstName: string; lastName: string; whatsappE164: string };
  serviceType: string;
  slotStart: Date;
  status: string;
  whatsappStatus: string;
  paymentMethod?: PaymentMethod | null;
  paymentMethods?: Array<{ method: PaymentMethod; amountCents: number }> | null;
}

function slotIdToTimeKey(slotId: string): string | null {
  // Legacy compatibility: some slotIds may be generated without zero-padding the hour (e.g. 20260112_900).
  // Accept both HHmm and Hmm formats.
  const m = slotId.match(/^(?:\d{8})_(\d{1,2})(\d{2})$/);
  if (!m) return null;
  const hour = m[1].padStart(2, '0');
  return `${hour}:${m[2]}`;
}

const SLOT_MINUTES = 30;
const GRID_ROW_PX = 44;

function formatBookingStatusPtBr(status: string) {
  switch (status) {
    case 'booked':
      return 'Agendado';
    case 'confirmed':
      return 'Confirmado';
    case 'completed':
      return 'Concluído';
    case 'no_show':
      return 'Falta';
    case 'cancelled':
      return 'Cancelado';
    default:
      return status;
  }
}

function getStatusCardClasses(status: string) {
  switch (status) {
    case 'confirmed':
      return 'bg-blue-100 border-blue-200 text-blue-900 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-100';
    case 'completed':
      return 'bg-green-100 border-green-200 text-green-900 dark:bg-green-900/30 dark:border-green-800 dark:text-green-100';
    case 'no_show':
      return 'bg-amber-100 border-amber-200 text-amber-900 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-100';
    case 'cancelled':
      return 'bg-muted/70 border-border text-muted-foreground';
    default:
      return 'bg-card border-border';
  }
}

function getStatusPillClasses(status: string) {
  switch (status) {
    case 'confirmed':
      return 'bg-blue-200/70 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100';
    case 'completed':
      return 'bg-green-200/70 text-green-900 dark:bg-green-900/40 dark:text-green-100';
    case 'no_show':
      return 'bg-amber-200/70 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100';
    case 'cancelled':
      return 'bg-red-200/70 text-red-900 dark:bg-red-900/40 dark:text-red-100';
    case 'booked':
      return 'bg-purple-200/70 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100';
    default:
      return 'bg-slate-200/70 text-slate-900 dark:bg-slate-800/40 dark:text-slate-100';
  }
}

type ViewMode = 'day' | 'week' | 'month';

export default function AgendaPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refreshToken = useAdminAutoRefreshToken();
  const [searchParams] = useSearchParams();
  const claims = api.admin.getClaims();
  const forcedBarberId = claims?.role === 'barber' ? (claims.barberId ?? null) : null;
  const isBarberUser = claims?.role === 'barber';
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const nowLineRef = useRef<HTMLDivElement | null>(null);
  const didAutoScrollRef = useRef<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedBarber, setSelectedBarber] = useState<string>('');
  const [barbers, setBarbers] = useState<Array<{ id: string; name: string }>>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blockedTimes, setBlockedTimes] = useState<Map<string, string>>(new Map()); // Map<timeKey, slotId>
  const [selectedBlock, setSelectedBlock] = useState<{ timeKey: string; slotId: string } | null>(null);
  const [unblockDialogOpen, setUnblockDialogOpen] = useState(false);
  const [unblocking, setUnblocking] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [createBookingModalOpen, setCreateBookingModalOpen] = useState(false);
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [nowTick, setNowTick] = useState(0);
  // Estado para modal de forma de pagamento
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | ''>('');
  const [splitMode, setSplitMode] = useState(false);
  const [paymentSplits, setPaymentSplits] = useState<Array<{ method: PaymentMethod; amountCents: number }>>([]);
  const [bookingToComplete, setBookingToComplete] = useState<Booking | null>(null);
  // Estados para produtos no checkout
  const [checkoutCart, setCheckoutCart] = useState<Array<{ productId: string; quantity: number }>>([]);
  const [showProductsSection, setShowProductsSection] = useState(false);

  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

  // Buscar lista de produtos ativos para o checkout
  const { data: productsData } = useQuery({
    queryKey: ['products-checkout'],
    queryFn: () => api.admin.listProducts({ activeOnly: true }),
    staleTime: 5 * 60 * 1000, // 5 minutos
    enabled: paymentModalOpen, // Só buscar quando o modal estiver aberto
  });
  const availableProducts = useMemo((): CheckoutProduct[] => {
    if (!productsData) return [];
    // Filtrar produtos com estoque > 0
    return productsData.filter(p => p.stockQuantity > 0);
  }, [productsData]);

  // Force re-render every minute to update "now" line
  useEffect(() => {
    const t = setInterval(() => setNowTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);
  void nowTick;

  // Derived state
  const dateKey = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).toFormat('yyyy-MM-dd');
  
  // TIME_SLOTS fixos para admin (07:30-20:00) - janela ampliada
  const TIME_SLOTS = ADMIN_TIME_SLOTS;
  
  const selectedDateLabel = useMemo(() => {
    const dt = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).setLocale('pt-BR');
    const now = DateTime.now().setZone('America/Sao_Paulo').startOf('day');
    const diff = dt.startOf('day').diff(now, 'days').days;

    if (viewMode === 'day') {
      let prefix = '';
      if (diff === 0) prefix = 'Hoje, ';
      else if (diff === 1) prefix = 'Amanhã, ';
      else if (diff === -1) prefix = 'Ontem, ';
      
      return prefix + dt.toFormat("cccc, dd 'de' LLLL 'de' yyyy");
    }
    if (viewMode === 'week') {
      const start = dt.startOf('week');
      const end = dt.endOf('week');
      return `${start.toFormat("dd 'de' LLLL")} - ${end.toFormat("dd 'de' LLLL")}`;
    }
    if (viewMode === 'month') return dt.toFormat("LLLL 'de' yyyy");
    return '';
  }, [selectedDate, viewMode]);

  const isToday = useMemo(() => {
    const dt = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).startOf('day');
    const now = DateTime.now().setZone('America/Sao_Paulo').startOf('day');
    return dt.equals(now);
  }, [selectedDate]);

  // Auto-scroll (one-shot) to the current-time (red) line when opening the day view for today.
  useEffect(() => {
    if (viewMode !== 'day') return;
    if (!isToday) return;
    if (!selectedBarber) return;

    const key = `${dateKey}|${selectedBarber}|${viewMode}`;
    if (didAutoScrollRef.current === key) return;

    let cancelled = false;

    const tryScroll = (attempt: number) => {
      if (cancelled) return;
      const container = scrollContainerRef.current;
      const target = nowLineRef.current;
      if (container && target) {
        const top = target.offsetTop;
        const desiredTop = Math.max(0, top - Math.floor(container.clientHeight * 0.35));
        container.scrollTo({ top: desiredTop, behavior: 'smooth' });
        didAutoScrollRef.current = key;
        return;
      }
      if (attempt >= 20) return;
      requestAnimationFrame(() => tryScroll(attempt + 1));
    };

    requestAnimationFrame(() => tryScroll(0));

    return () => {
      cancelled = true;
    };
  }, [dateKey, isToday, selectedBarber, viewMode]);

  // Navigation handlers
  const handleNavigate = (direction: 'prev' | 'next' | 'today') => {
    const dt = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' });
    if (direction === 'today') {
      setSelectedDate(DateTime.now().setZone('America/Sao_Paulo').toJSDate());
      return;
    }
    
    const amount = direction === 'next' ? 1 : -1;
    let nextDate = dt;
    
    if (viewMode === 'day') nextDate = dt.plus({ days: amount });
    else if (viewMode === 'week') nextDate = dt.plus({ weeks: amount });
    else if (viewMode === 'month') nextDate = dt.plus({ months: amount });
    
    setSelectedDate(nextDate.toJSDate());
  };

  // Initial load
  useEffect(() => {
    void (async () => {
      try {
        const { items } = await api.admin.listBarbers();
        const normalized = (items ?? []).map((b) => ({ id: b.id, name: b.name }));
        const sorted = [...normalized].sort((a, b) => {
          const aIsOwner = a.id === 'sr-cardoso';
          const bIsOwner = b.id === 'sr-cardoso';
          if (aIsOwner && !bIsOwner) return -1;
          if (!aIsOwner && bIsOwner) return 1;
          return a.name.localeCompare(b.name, 'pt-BR');
        });
        setBarbers(sorted);

        const qsBarber = searchParams.get('barber');
        const qsDate = searchParams.get('date');

        // Barber users must always operate on their own barberId.
        if (forcedBarberId) {
          if (forcedBarberId !== selectedBarber) setSelectedBarber(forcedBarberId);
        }

        const nextBarber =
          !forcedBarberId && qsBarber && sorted.some((b) => b.id === qsBarber)
            ? qsBarber
            : sorted.find((b) => b.id === 'sr-cardoso')?.id ?? sorted[0]?.id ?? '';

        if (!forcedBarberId && nextBarber && nextBarber !== selectedBarber) setSelectedBarber(nextBarber);

        if (qsDate) {
          const parsed = DateTime.fromFormat(qsDate, 'yyyy-MM-dd', { zone: 'America/Sao_Paulo' });
          if (parsed.isValid) setSelectedDate(parsed.toJSDate());
        }
      } catch {
        setBarbers([]);
        if (forcedBarberId) {
          if (!selectedBarber) setSelectedBarber(forcedBarberId);
        } else {
          if (!selectedBarber) setSelectedBarber('sr-cardoso');
        }
      }
    })();
    // Efeito de inicialização: roda apenas uma vez no mount.
    // forcedBarberId/selectedBarber/searchParams são lidos mas não devem re-disparar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hard safety-net: if a barber user somehow changes selectedBarber, snap back.
  useEffect(() => {
    if (!forcedBarberId) return;
    if (selectedBarber !== forcedBarberId) setSelectedBarber(forcedBarberId);
  }, [forcedBarberId, selectedBarber]);

  // Load bookings
  useEffect(() => {
    if (!selectedBarber) return;
    loadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedBarber, viewMode, refreshToken]);

  const loadBookings = async () => {
    setLoading(true);
    try {
      let items: unknown[] = [];
      const nextBlocked = new Map<string, string>(); // Map<timeKey, slotId>

      if (viewMode === 'day') {
        const [res, availability] = await Promise.all([
          api.admin.listBookings(selectedBarber, dateKey),
          api.availability(selectedBarber, dateKey),
        ]);
        items = res.items;
        (availability?.blockedSlotIds ?? []).forEach((slotId) => {
          if (typeof slotId === 'string') {
            const tk = slotIdToTimeKey(slotId);
            if (tk) nextBlocked.set(tk, slotId);
          }
        });
      } else {
        let start: DateTime, end: DateTime;
        const dt = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' });
        
        if (viewMode === 'week') {
          start = dt.startOf('week');
          end = dt.endOf('week');
        } else {
          start = dt.startOf('month').startOf('week');
          end = dt.endOf('month').endOf('week');
        }

        const res = await api.admin.listBookings(selectedBarber, undefined, {
          start: start.toFormat('yyyy-MM-dd'),
          end: end.toFormat('yyyy-MM-dd'),
        });
        items = res.items;
      }

      const loadedBookings = items.map((raw): Booking | null => {
        if (!isRecord(raw)) return null;
        const data = raw;
        const slotStartIso = typeof data.slotStart === 'string' ? data.slotStart : null;
        if (!slotStartIso) return null;
        const slotStart = DateTime.fromISO(slotStartIso, { zone: 'America/Sao_Paulo' }).toJSDate();
        return {
          id: String(data.id ?? ''),
          barberId: typeof data.barberId === 'string' ? data.barberId : undefined,
          customer: data.customer as Booking['customer'],
          serviceType: String(data.serviceType ?? ''),
          slotStart,
          status: String(data.status ?? ''),
          whatsappStatus: String(data.whatsappStatus ?? ''),
        };
      }).filter((b): b is Booking => b !== null);

      setBookings(loadedBookings);
      setBlockedTimes(nextBlocked);
    } catch (error) {
      console.error('Error loading bookings:', error);
      toast({ title: 'Erro', description: 'Não foi possível carregar a agenda.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Mutations (Cancel, Status)
  const cancelMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      await adminCancelBookingFn({ bookingId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      loadBookings();
      setSelectedBooking(null);
      toast({ title: 'Sucesso', description: 'Reserva cancelada.' });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Erro ao cancelar.';
      toast({ title: 'Erro', description: msg, variant: 'destructive' });
    },
  });

  const setStatusMutation = useMutation({
    mutationFn: async (payload: { bookingId: string; status: 'confirmed' | 'completed' | 'no_show'; paymentMethod?: PaymentMethod; paymentMethods?: Array<{ method: PaymentMethod; amountCents: number }> }) => {
      return api.admin.setBookingStatus(payload.bookingId, payload.status, payload.paymentMethod, payload.paymentMethods);
    },
    onSuccess: (_data, variables) => {
      loadBookings();
      setSelectedBooking((prev) => (prev
        ? {
            ...prev,
            status: variables.status,
            paymentMethod: variables.paymentMethod ?? variables.paymentMethods?.[0]?.method ?? prev.paymentMethod,
            paymentMethods: variables.paymentMethods ?? prev.paymentMethods,
          }
        : prev));
      // Auto-fechar modal após ação de status
      setSelectedBooking(null);
      toast({ title: 'Sucesso', description: 'Status atualizado.' });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar status.';
      toast({ title: 'Erro', description: msg, variant: 'destructive' });
    },
  });

  // Handler para abrir modal de pagamento ao clicar em Concluir
  const handleConcluirClick = (booking: Booking) => {
    setBookingToComplete(booking);
    setSelectedPaymentMethod('');
    setSplitMode(false);
    setPaymentSplits([]);
    setCheckoutCart([]);
    setShowProductsSection(false);
    setPaymentModalOpen(true);
  };

  // Helpers para manipular carrinho de produtos
  const addToCart = (productId: string) => {
    const product = availableProducts.find(p => p.id === productId);
    if (!product) return;
    
    setCheckoutCart(prev => {
      const existing = prev.find(item => item.productId === productId);
      if (existing) {
        // Não permitir adicionar mais que o estoque disponível
        if (existing.quantity >= product.stockQuantity) return prev;
        return prev.map(item => 
          item.productId === productId 
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { productId, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCheckoutCart(prev => {
      const existing = prev.find(item => item.productId === productId);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        return prev.filter(item => item.productId !== productId);
      }
      return prev.map(item =>
        item.productId === productId
          ? { ...item, quantity: item.quantity - 1 }
          : item
      );
    });
  };

  const getCartTotal = () => {
    return checkoutCart.reduce((total, item) => {
      const product = availableProducts.find(p => p.id === item.productId);
      return total + (product?.priceCents ?? 0) * item.quantity;
    }, 0);
  };

  const updateSplitAmount = (method: PaymentMethod, amountCents: number) => {
    setPaymentSplits((prev) => {
      const existing = prev.find((entry) => entry.method === method);
      if (amountCents <= 0) {
        return prev.filter((entry) => entry.method !== method);
      }
      if (existing) {
        return prev.map((entry) =>
          entry.method === method ? { ...entry, amountCents } : entry
        );
      }
      return [...prev, { method, amountCents }];
    });
  };

  const getSplitTotal = () => {
    return paymentSplits.reduce((sum, entry) => sum + entry.amountCents, 0);
  };

  // Handler para confirmar conclusão com forma de pagamento
  const handleConfirmComplete = async () => {
    if (!bookingToComplete) return;

    if (splitMode) {
      if (paymentSplits.length === 0) {
        toast({ title: 'Erro', description: 'Informe pelo menos uma forma de pagamento.', variant: 'destructive' });
        return;
      }
    } else if (!selectedPaymentMethod) {
      toast({ title: 'Erro', description: 'Selecione a forma de pagamento.', variant: 'destructive' });
      return;
    }

    const primaryMethod = splitMode
      ? paymentSplits[0]?.method
      : (selectedPaymentMethod || undefined);
    
    try {
      // 1. Atualizar status do booking
      setStatusMutation.mutate({ 
        bookingId: bookingToComplete.id, 
        status: 'completed', 
        paymentMethod: splitMode ? undefined : (selectedPaymentMethod || undefined),
        paymentMethods: splitMode ? paymentSplits : undefined,
      });
      
      // 2. Se há produtos no carrinho, criar a venda
      if (checkoutCart.length > 0 && bookingToComplete.barberId && primaryMethod) {
        const items = checkoutCart.map(item => {
          const product = availableProducts.find(p => p.id === item.productId);
          return {
            productId: item.productId,
            quantity: item.quantity,
            unitPriceCents: product?.priceCents ?? 0,
          };
        });
        
        await api.admin.createSale({
          barberId: bookingToComplete.barberId,
          customerId: undefined, // Poderia vincular ao cliente do booking se tivéssemos o ID
          paymentMethod: primaryMethod,
          items,
          bookingId: bookingToComplete.id,
        });
        
        toast({ 
          title: 'Venda registrada', 
          description: `${checkoutCart.length} produto(s) vendido(s).` 
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao registrar venda.';
      toast({ title: 'Erro', description: msg, variant: 'destructive' });
    }
    
    setPaymentModalOpen(false);
    setBookingToComplete(null);
    setSelectedPaymentMethod('');
    setCheckoutCart([]);
    setShowProductsSection(false);
  };

  const handleOpenWhatsApp = (booking: Booking) => {
    // Extrai apenas os dígitos do número E.164 (remove o +)
    const phoneNumber = booking.customer.whatsappE164.replace(/\D/g, '');
    // Abre a conversa direta no WhatsApp Web/App
    window.open(`https://wa.me/${phoneNumber}`, '_blank');
    // Auto-fechar modal após ação de WhatsApp
    setSelectedBooking(null);
  };

  // Função para desbloquear slot
  const handleUnblockSlot = async () => {
    if (!selectedBlock || !selectedBarber) return;
    
    setUnblocking(true);
    try {
      await api.admin.unblockSlot(selectedBarber, selectedBlock.slotId);
      toast({ 
        title: 'Sucesso', 
        description: `Horário ${selectedBlock.timeKey} desbloqueado.` 
      });
      setUnblockDialogOpen(false);
      setSelectedBlock(null);
      loadBookings();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao desbloquear horário.';
      toast({ title: 'Erro', description: msg, variant: 'destructive' });
    } finally {
      setUnblocking(false);
    }
  };

  // Render Helpers
  const renderDayView = () => {
    const gridStartTime = TIME_SLOTS[0] ?? '08:00';
    const [gridStartH, gridStartM] = gridStartTime.split(':').map(Number);
    const dayStart = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).set({
      hour: Number.isFinite(gridStartH) ? gridStartH : 8,
      minute: Number.isFinite(gridStartM) ? gridStartM : 0,
      second: 0,
      millisecond: 0,
    });
    
    // Filter bookings for this day (exclude cancelled - they pollute the view when someone else books the same slot)
    const dayBookings = bookings.filter(b => 
      DateTime.fromJSDate(b.slotStart, { zone: 'America/Sao_Paulo' }).hasSame(dayStart, 'day') &&
      b.status !== 'cancelled'
    );

    const events = [
      ...dayBookings.map(b => {
        const start = DateTime.fromJSDate(b.slotStart, { zone: 'America/Sao_Paulo' });
        const minutesFromStart = start.diff(dayStart, 'minutes').minutes;
        const topPx = (minutesFromStart / SLOT_MINUTES) * GRID_ROW_PX;
        return { kind: 'booking' as const, booking: b, topPx, heightPx: GRID_ROW_PX };
      }),
      ...Array.from(blockedTimes.entries()).map(([timeKey, slotId]) => {
        const [h, m] = timeKey.split(':').map(Number);
        const start = dayStart.set({ hour: h, minute: m });
        const minutesFromStart = start.diff(dayStart, 'minutes').minutes;
        const topPx = (minutesFromStart / SLOT_MINUTES) * GRID_ROW_PX;
        return { kind: 'block' as const, timeKey, slotId, topPx, heightPx: GRID_ROW_PX };
      })
    ].filter(e => e.topPx >= 0 && e.topPx < TIME_SLOTS.length * GRID_ROW_PX);

    // Now line
    const now = DateTime.now().setZone('America/Sao_Paulo');
    const isToday = now.hasSame(dayStart, 'day');
    const nowMinutes = now.diff(dayStart, 'minutes').minutes;
    const nowTopPx = (nowMinutes / SLOT_MINUTES) * GRID_ROW_PX;
    const gridHeightPx = TIME_SLOTS.length * GRID_ROW_PX;
    const clampedNowTopPx = gridHeightPx > 0 ? Math.min(Math.max(nowTopPx, 0), gridHeightPx - 1) : 0;
    const showNowLine = isToday;

    return (
      <div className="relative border-t border-border/60">
        <div className="grid grid-cols-[60px_1fr]">
          <div className="bg-background/40">
            {TIME_SLOTS.map((time) => (
              <div key={time} className="border-b border-border/60 pr-2 h-[44px] flex items-start justify-end pt-1">
                <span className="font-mono text-xs text-muted-foreground">{time}</span>
              </div>
            ))}
          </div>
          <div className="relative border-l border-border/60">
            {TIME_SLOTS.map((time) => (
              <div key={time} className="border-b border-border/40 h-[44px]" />
            ))}
            
            {showNowLine && (
              <div
                ref={nowLineRef}
                className="absolute left-0 right-0 z-20 pointer-events-none"
                style={{ top: clampedNowTopPx }}
              >
                <div className="relative">
                  <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-red-500 shadow-sm" />
                  <div className="h-0.5 bg-red-500 shadow-sm" />
                </div>
              </div>
            )}

            {events.map((ev) => {
              if (ev.kind === 'block') {
                return (
                  <button
                    key={`block-${ev.timeKey}`}
                    onClick={() => {
                      setSelectedBlock({ timeKey: ev.timeKey, slotId: ev.slotId });
                      setUnblockDialogOpen(true);
                    }}
                    className="absolute left-1 right-1 rounded bg-muted/80 border border-border p-2 text-xs text-muted-foreground flex items-center justify-center gap-2 cursor-pointer hover:bg-muted hover:border-primary/50 transition-colors active:scale-[0.98]"
                    style={{ top: ev.topPx, height: ev.heightPx - 4 }}
                  >
                    <Lock className="h-3 w-3" />
                    Fechado
                  </button>
                );
              }
              const b = ev.booking;
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedBooking(b)}
                  className={cn(
                    "absolute left-1 right-1 rounded px-2 py-1 text-left text-xs border shadow-sm transition-all hover:z-10",
                    getStatusCardClasses(b.status)
                  )}
                  style={{ top: ev.topPx, height: ev.heightPx - 4 }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className={cn('font-semibold truncate', b.status === 'cancelled' && 'line-through')}>{b.customer.firstName}</div>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                        getStatusPillClasses(b.status)
                      )}
                    >
                      {formatBookingStatusPtBr(b.status)}
                    </span>
                  </div>
                  <div className="truncate opacity-80">{SERVICE_LABELS[b.serviceType] || b.serviceType}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const startOfWeek = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).startOf('week');
    const days = Array.from({ length: 7 }, (_, i) => startOfWeek.plus({ days: i }));
    const dayStartHour = 8;

    return (
      <div className="overflow-x-auto">
        <div className="min-w-[800px] grid grid-cols-[60px_repeat(7,1fr)] border-t border-border/60">
          {/* Header */}
          <div className="sticky left-0 bg-background z-20 border-b border-r p-2" />
          {days.map(day => (
            <div key={day.toISODate()} className={cn(
              "text-center p-2 border-b border-r font-medium text-sm",
              day.hasSame(DateTime.now().setZone('America/Sao_Paulo'), 'day') && "bg-primary/5 text-primary"
            )}>
              <div className="uppercase text-[10px] text-muted-foreground">{day.toFormat('ccc')}</div>
              <div>{day.toFormat('dd')}</div>
            </div>
          ))}

          {/* Time Grid */}
          <div className="sticky left-0 bg-background z-20 border-r">
            {TIME_SLOTS.map(time => (
              <div key={time} className="h-[44px] border-b text-xs text-muted-foreground flex items-start justify-end pr-2 pt-1">
                {time}
              </div>
            ))}
          </div>

          {days.map(day => {
             const dayBookings = bookings.filter(b => 
              DateTime.fromJSDate(b.slotStart, { zone: 'America/Sao_Paulo' }).hasSame(day, 'day') &&
              b.status !== 'cancelled'
            );
            return (
              <div key={day.toISODate()} className="relative border-r border-border/40 bg-background/30">
                {TIME_SLOTS.map(time => (
                  <div key={time} className="h-[44px] border-b border-border/40" />
                ))}
                {dayBookings.map(b => {
                  const start = DateTime.fromJSDate(b.slotStart, { zone: 'America/Sao_Paulo' });
                  const minutesFromStart = start.diff(day.set({ hour: dayStartHour, minute: 0 }), 'minutes').minutes;
                  const topPx = (minutesFromStart / SLOT_MINUTES) * GRID_ROW_PX;
                  if (topPx < 0 || topPx >= TIME_SLOTS.length * GRID_ROW_PX) return null;
                  
                  return (
                    <button
                      key={b.id}
                      onClick={() => setSelectedBooking(b)}
                      className={cn(
                        "absolute left-0.5 right-0.5 rounded px-1 py-0.5 text-xs border shadow-sm overflow-hidden hover:z-10",
                        getStatusCardClasses(b.status)
                      )}
                      style={{ top: topPx, height: GRID_ROW_PX - 2 }}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className={cn('font-semibold truncate', b.status === 'cancelled' && 'line-through')}>{b.customer.firstName}</div>
                        <span
                          className={cn(
                            'rounded px-1 py-0.5 text-[10px] font-medium',
                            getStatusPillClasses(b.status)
                          )}
                        >
                          {formatBookingStatusPtBr(b.status)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMonthView = () => {
    const start = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).startOf('month').startOf('week');
    const end = DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }).endOf('month').endOf('week');
    const days = [];
    let curr = start;
    while (curr <= end) {
      days.push(curr);
      curr = curr.plus({ days: 1 });
    }

    return (
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden shadow-sm">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
          <div key={d} className="bg-muted/50 p-2 text-center text-xs font-medium text-muted-foreground uppercase">
            {d}
          </div>
        ))}
        {days.map(day => {
          const isCurrentMonth = day.hasSame(DateTime.fromJSDate(selectedDate, { zone: 'America/Sao_Paulo' }), 'month');
          const dayBookings = bookings.filter(b => 
            DateTime.fromJSDate(b.slotStart, { zone: 'America/Sao_Paulo' }).hasSame(day, 'day') &&
            b.status !== 'cancelled'
          );
          const isToday = day.hasSame(DateTime.now().setZone('America/Sao_Paulo'), 'day');

          return (
            <div 
              key={day.toISODate()} 
              className={cn(
                "bg-card min-h-[120px] p-2 transition-colors hover:bg-accent/5",
                !isCurrentMonth && "bg-muted/20 text-muted-foreground"
              )}
              onClick={() => {
                setSelectedDate(day.toJSDate());
                setViewMode('day');
              }}
            >
              <div className={cn("text-sm font-medium mb-2 w-6 h-6 flex items-center justify-center rounded-full", isToday && "bg-primary text-primary-foreground")}>
                {day.day}
              </div>
              <div className="space-y-1">
                {dayBookings.slice(0, 4).map(b => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedBooking(b);
                    }}
                    className={cn(
                      "w-full text-left text-[11px] px-2 py-1 rounded truncate border hover:opacity-90 min-h-[28px]",
                      b.status === 'confirmed' ? "bg-blue-50 border-blue-100 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200" :
                      b.status === 'completed' ? "bg-green-50 border-green-100 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200" :
                      b.status === 'no_show' ? "bg-amber-50 border-amber-100 text-amber-700 dark:bg-amber-900/20 dark:border-blue-800 dark:text-amber-200" :
                      b.status === 'cancelled' ? "bg-muted/60 border-border text-muted-foreground" :
                      "bg-muted border-transparent"
                    )}
                  >
                    {DateTime.fromJSDate(b.slotStart, { zone: 'America/Sao_Paulo' }).toFormat('HH:mm')} {b.customer.firstName} • {formatBookingStatusPtBr(b.status)}
                  </button>
                ))}
                {dayBookings.length > 4 && (
                  <div className="text-[10px] text-muted-foreground font-medium pl-1">
                    mais +{dayBookings.length - 4}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <AdminLayout>
      <div className="space-y-4 h-[calc(100vh-140px)] flex flex-col">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
          <div className="space-y-1">
            <h2 className="text-2xl font-serif font-bold">Agenda</h2>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="capitalize">{selectedDateLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-card border rounded-lg p-1 shadow-sm">
            <Button variant="ghost" size="sm" onClick={() => handleNavigate('prev')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleNavigate('today')}>
              {isToday ? 'Hoje' : 'Ir para Hoje'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleNavigate('next')}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
             <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)} className="w-auto">
              <TabsList>
                <TabsTrigger value="day" className="px-3"><List className="h-4 w-4 mr-2" /> Dia</TabsTrigger>
                <TabsTrigger value="week" className="px-3"><Columns className="h-4 w-4 mr-2" /> Semana</TabsTrigger>
                <TabsTrigger value="month" className="px-3"><LayoutGrid className="h-4 w-4 mr-2" /> Mês</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <Tabs
          value={selectedBarber}
          onValueChange={(v) => {
            if (isBarberUser) return;
            setSelectedBarber(v);
          }}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="w-full overflow-x-auto shrink-0 pb-2">
            <TabsList className="w-max min-w-full justify-start flex-nowrap">
              {barbers.map((barber) => (
                <TabsTrigger key={barber.id} value={barber.id} className="whitespace-nowrap">
                  {barber.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex-1 min-h-0 relative bg-card/50 backdrop-blur-sm border rounded-lg overflow-hidden shadow-sm">
            {loading && (
              <div className="absolute inset-0 z-50 bg-background/50 flex items-center justify-center">
                <LoadingSpinner />
              </div>
            )}
            
            <div ref={scrollContainerRef} className="h-full overflow-y-auto">
              {viewMode === 'day' && renderDayView()}
              {viewMode === 'week' && renderWeekView()}
              {viewMode === 'month' && renderMonthView()}
            </div>
          </div>
        </Tabs>
      </div>

      {/* Booking Details Dialog */}
      <Dialog open={!!selectedBooking} onOpenChange={() => setSelectedBooking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalhes da Reserva</DialogTitle>
            <DialogDescription>
              {selectedBooking && `${selectedBooking.customer.firstName} ${selectedBooking.customer.lastName}`}
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                <p><span className="font-medium">Serviço:</span> {SERVICE_LABELS[selectedBooking.serviceType] || selectedBooking.serviceType}</p>
                <p><span className="font-medium">Horário:</span> {formatTime(selectedBooking.slotStart)}</p>
                <p><span className="font-medium">WhatsApp:</span> {selectedBooking.customer.whatsappE164}</p>
                <p><span className="font-medium">Status:</span> <Badge>{formatBookingStatusPtBr(selectedBooking.status)}</Badge></p>
                {selectedBooking.paymentMethod && (
                  <p><span className="font-medium">Forma de pagamento:</span> {PAYMENT_METHOD_LABELS[selectedBooking.paymentMethod]}</p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => handleOpenWhatsApp(selectedBooking)} size="sm">WhatsApp</Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={['cancelled', 'completed', 'no_show'].includes(selectedBooking.status) || setStatusMutation.isPending}
                  onClick={() => handleConcluirClick(selectedBooking)}
                >
                  Concluir
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={['cancelled', 'completed', 'no_show'].includes(selectedBooking.status) || setStatusMutation.isPending}
                  onClick={() => setStatusMutation.mutate({ bookingId: selectedBooking.id, status: 'no_show' })}
                >
                  Falta
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={selectedBooking.status === 'cancelled' || cancelMutation.isPending}
                  onClick={() => {
                    if (confirm('Cancelar?')) cancelMutation.mutate(selectedBooking.id);
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Payment Method Dialog */}
      <Dialog open={paymentModalOpen} onOpenChange={(open) => {
        if (!open) {
          setPaymentModalOpen(false);
          setBookingToComplete(null);
          setSelectedPaymentMethod('');
          setSplitMode(false);
          setPaymentSplits([]);
          setCheckoutCart([]);
          setShowProductsSection(false);
        }
      }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Concluir Atendimento</DialogTitle>
            <DialogDescription>
              Selecione a forma de pagamento{availableProducts.length > 0 ? ' e adicione produtos se desejar' : ''}.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto py-2 space-y-4">
            {/* Forma de Pagamento */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-base font-medium">Forma de Pagamento</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Dividir</span>
                  <Switch checked={splitMode} onCheckedChange={setSplitMode} />
                </div>
              </div>

              {splitMode ? (
                <div className="space-y-3">
                  {(['pix', 'cash', 'credit', 'debit'] as PaymentMethod[]).map((method) => {
                    const current = paymentSplits.find((entry) => entry.method === method);
                    const value = current ? (current.amountCents / 100).toFixed(2).replace('.', ',') : '';
                    return (
                      <div key={method} className="flex items-center gap-3">
                        <span className="w-24 text-sm font-medium">{PAYMENT_METHOD_LABELS[method]}</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          value={value}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => {
                            const raw = e.target.value.replace(/[^0-9,]/g, '').replace(',', '.');
                            const amount = raw ? Math.round(parseFloat(raw) * 100) : 0;
                            updateSplitAmount(method, amount);
                          }}
                          className="flex-1"
                        />
                      </div>
                    );
                  })}
                  <div className="text-right text-sm font-medium">
                    Total split: {(getSplitTotal() / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
              ) : (
                <RadioGroup 
                  value={selectedPaymentMethod} 
                  onValueChange={(value) => setSelectedPaymentMethod(value as PaymentMethod)}
                  className="grid grid-cols-2 gap-2"
                >
                  <div 
                    className={cn(
                      "flex flex-col items-center justify-center p-3 border rounded-xl cursor-pointer transition-all min-h-[70px] active:scale-95",
                      selectedPaymentMethod === 'credit' ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-accent/50"
                    )}
                    onClick={() => setSelectedPaymentMethod('credit')}
                  >
                    <RadioGroupItem value="credit" id="payment-credit" className="sr-only" />
                    <span className="text-xl mb-0.5">💳</span>
                    <Label htmlFor="payment-credit" className="cursor-pointer text-sm font-medium text-center">
                      Crédito
                    </Label>
                  </div>
                  <div 
                    className={cn(
                      "flex flex-col items-center justify-center p-3 border rounded-xl cursor-pointer transition-all min-h-[70px] active:scale-95",
                      selectedPaymentMethod === 'debit' ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-accent/50"
                    )}
                    onClick={() => setSelectedPaymentMethod('debit')}
                  >
                    <RadioGroupItem value="debit" id="payment-debit" className="sr-only" />
                    <span className="text-xl mb-0.5">💳</span>
                    <Label htmlFor="payment-debit" className="cursor-pointer text-sm font-medium text-center">
                      Débito
                    </Label>
                  </div>
                  <div 
                    className={cn(
                      "flex flex-col items-center justify-center p-3 border rounded-xl cursor-pointer transition-all min-h-[70px] active:scale-95",
                      selectedPaymentMethod === 'cash' ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-accent/50"
                    )}
                    onClick={() => setSelectedPaymentMethod('cash')}
                  >
                    <RadioGroupItem value="cash" id="payment-cash" className="sr-only" />
                    <span className="text-xl mb-0.5">💵</span>
                    <Label htmlFor="payment-cash" className="cursor-pointer text-sm font-medium text-center">
                      Dinheiro
                    </Label>
                  </div>
                  <div 
                    className={cn(
                      "flex flex-col items-center justify-center p-3 border rounded-xl cursor-pointer transition-all min-h-[70px] active:scale-95",
                      selectedPaymentMethod === 'pix' ? "border-primary bg-primary/10 ring-2 ring-primary" : "hover:bg-accent/50"
                    )}
                    onClick={() => setSelectedPaymentMethod('pix')}
                  >
                    <RadioGroupItem value="pix" id="payment-pix" className="sr-only" />
                    <span className="text-xl mb-0.5">📱</span>
                    <Label htmlFor="payment-pix" className="cursor-pointer text-sm font-medium text-center">
                      Pix
                    </Label>
                  </div>
                </RadioGroup>
              )}
            </div>

            {/* Seção de Produtos */}
            {availableProducts.length > 0 && (
              <div className="border-t pt-4">
                <button
                  type="button"
                  className="flex items-center justify-between w-full text-left"
                  onClick={() => setShowProductsSection(!showProductsSection)}
                >
                  <div className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-muted-foreground" />
                    <span className="font-medium">Adicionar Produtos</span>
                    {checkoutCart.length > 0 && (
                      <Badge variant="secondary" className="ml-1">
                        {checkoutCart.reduce((sum, item) => sum + item.quantity, 0)}
                      </Badge>
                    )}
                  </div>
                  <ChevronRight className={cn(
                    "h-5 w-5 text-muted-foreground transition-transform",
                    showProductsSection && "rotate-90"
                  )} />
                </button>

                {showProductsSection && (
                  <div className="mt-3 space-y-2">
                    <ScrollArea className="h-[200px] rounded-md border p-2">
                      <div className="space-y-2">
                        {availableProducts.map((product) => {
                          const cartItem = checkoutCart.find(item => item.productId === product.id);
                          const quantity = cartItem?.quantity ?? 0;
                          return (
                            <div 
                              key={product.id}
                              className="flex items-center justify-between p-2 rounded-lg border bg-card/50"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{product.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {(product.priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                  <span className="ml-2 opacity-60">({product.stockQuantity} em estoque)</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 ml-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => removeFromCart(product.id)}
                                  disabled={quantity === 0}
                                >
                                  <Minus className="h-4 w-4" />
                                </Button>
                                <span className="w-8 text-center font-medium">{quantity}</span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => addToCart(product.id)}
                                  disabled={quantity >= product.stockQuantity}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>

                    {/* Resumo do carrinho */}
                    {checkoutCart.length > 0 && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <div className="flex items-center gap-2">
                          <ShoppingCart className="h-4 w-4 text-amber-600" />
                          <span className="text-sm font-medium">
                            {checkoutCart.reduce((sum, item) => sum + item.quantity, 0)} produto(s)
                          </span>
                        </div>
                        <span className="font-bold text-amber-700 dark:text-amber-400">
                          {(getCartTotal() / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-row gap-2 sm:gap-0 pt-4 border-t">
            <Button 
              variant="outline" 
              className="flex-1 sm:flex-none h-12"
              onClick={() => {
                setPaymentModalOpen(false);
                setBookingToComplete(null);
                setSelectedPaymentMethod('');
                setSplitMode(false);
                setPaymentSplits([]);
                setCheckoutCart([]);
                setShowProductsSection(false);
              }}
            >
              Voltar
            </Button>
            <Button 
              className="flex-1 sm:flex-none h-12"
              onClick={handleConfirmComplete}
              disabled={(splitMode ? paymentSplits.length === 0 : !selectedPaymentMethod) || setStatusMutation.isPending}
            >
              {setStatusMutation.isPending ? 'Processando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BlockSlotsModal
        open={blockModalOpen}
        onOpenChange={(open) => {
          setBlockModalOpen(open);
          if (!open) loadBookings();
        }}
        selectedDate={selectedDate}
        selectedBarberId={selectedBarber}
        barbers={barbers}
        disableBarberSelect={isBarberUser}
      />

      <CreateBookingModal
        open={createBookingModalOpen}
        onOpenChange={setCreateBookingModalOpen}
        selectedDate={selectedDate}
        selectedBarber={selectedBarber}
        onSuccess={() => loadBookings()}
      />
      
      {/* Sale Modal */}
      <SaleModal
        open={saleModalOpen}
        onOpenChange={setSaleModalOpen}
        onSuccess={() => setSaleModalOpen(false)}
        defaultBarberId={selectedBarber}
        barbers={barbers}
      />

      {/* Floating Action Buttons (only visible in Day view) */}
      {viewMode === 'day' && (
        <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50">
          <Button
            className="rounded-full h-14 w-14 shadow-lg"
            variant="secondary"
            onClick={() => setSaleModalOpen(true)}
            title="Nova venda de produtos"
          >
            <ShoppingCart className="h-6 w-6" />
          </Button>
          <Button
            className="rounded-full h-14 w-14 shadow-lg"
            variant="secondary"
            onClick={() => setBlockModalOpen(true)}
            title="Bloquear horários"
          >
            <CalendarIcon className="h-6 w-6" />
          </Button>
          <Button
            className="rounded-full h-14 w-14 shadow-lg"
            onClick={() => setCreateBookingModalOpen(true)}
            title="Novo agendamento"
          >
            <Plus className="h-6 w-6" />
          </Button>
        </div>
      )}

      {/* Dialog de confirmação para desbloquear */}
      <AlertDialog open={unblockDialogOpen} onOpenChange={setUnblockDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unlock className="h-5 w-5" />
              Desbloquear Horário
            </AlertDialogTitle>
            <AlertDialogDescription>
              Deseja remover o bloqueio do horário <strong>{selectedBlock?.timeKey}</strong>?
              <br />
              Este horário ficará disponível para agendamentos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unblocking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnblockSlot}
              disabled={unblocking}
              className="bg-primary"
            >
              {unblocking ? 'Desbloqueando...' : 'Desbloquear'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
