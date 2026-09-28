import type { PillTone } from '../components/ui/Feedback';
import type { OrderStatus, TicketStatus } from '../../shared/types';

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: PillTone }> = {
  reserved: { label: 'Reservert', tone: 'tint' },
  pending_payment: { label: 'Venter på betaling', tone: 'orange' },
  paid: { label: 'Betalt', tone: 'green' },
  cancelled: { label: 'Avbrutt', tone: 'neutral' },
  expired: { label: 'Utløpt', tone: 'neutral' },
  refunded: { label: 'Refundert', tone: 'neutral' },
  partially_refunded: { label: 'Delvis refundert', tone: 'orange' },
};

export const TICKET_STATUS: Record<TicketStatus, { label: string; tone: PillTone }> = {
  valid: { label: 'Gyldig', tone: 'green' },
  used: { label: 'Brukt', tone: 'neutral' },
  refunded: { label: 'Refundert', tone: 'neutral' },
  cancelled: { label: 'Kansellert', tone: 'red' },
};
