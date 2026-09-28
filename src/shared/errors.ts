/**
 * Error codes shared by server and client. Messages are written for the person using the app:
 * what went wrong and what to do next – no apologies, no internals.
 */

export const ERROR_MESSAGES = {
  bad_request: 'Noe i forespørselen var ugyldig. Sjekk feltene og prøv igjen.',
  validation: 'Noen felt må rettes før du kan fortsette.',
  unauthorized: 'Du må logge inn for å fortsette.',
  forbidden: 'Du har ikke tilgang til dette.',
  not_found: 'Fant ikke det du lette etter. Det kan ha blitt flyttet eller slettet.',
  conflict: 'Dette ble endret av noen andre akkurat nå. Last inn på nytt og prøv igjen.',
  rate_limited: 'For mange forsøk på kort tid. Vent litt og prøv igjen.',
  csrf: 'Forespørselen ble avvist av sikkerhetshensyn. Last inn siden på nytt.',
  internal: 'Noe gikk galt hos oss. Prøv igjen om litt.',
  unavailable: 'Tjenesten er midlertidig utilgjengelig. Prøv igjen om litt.',

  // Buying
  event_not_on_sale: 'Billettsalget er ikke åpent for dette arrangementet.',
  sold_out: 'Utsolgt. Bli med på ventelisten, så varsler vi deg hvis det åpner seg plasser.',
  not_enough_tickets: 'Det er ikke nok billetter igjen av typen du valgte. Velg færre eller en annen billettype.',
  too_many_tickets: 'Du har valgt flere billetter enn det er lov å kjøpe per bestilling.',
  invalid_ticket_type: 'Billettypen finnes ikke lenger. Last inn arrangementet på nytt.',
  ticket_type_locked: 'Denne billettypen krever en tilgangskode.',
  invalid_access_code: 'Tilgangskoden er ikke gyldig for dette arrangementet.',
  invalid_discount_code: 'Rabattkoden er ikke gyldig.',
  discount_used_up: 'Rabattkoden er brukt opp.',
  discount_expired: 'Rabattkoden har utløpt.',
  queue_required: 'Billettslippet har kø. Stå i køen for å kjøpe billetter.',
  queue_token_invalid: 'Køplassen din har utløpt. Still deg i kø på nytt.',
  age_required: 'Legg inn fødselsdatoen din i profilen før du kjøper billetter til dette arrangementet.',
  age_too_young: 'Du oppfyller ikke aldersgrensen for dette arrangementet.',
  age_verification_required: 'Arrangøren krever at alderen din er bekreftet med Vipps. Koble til Vipps i profilen din.',
  order_expired: 'Reservasjonen har utløpt, og billettene er frigitt. Velg billetter på nytt.',
  order_not_payable: 'Denne bestillingen kan ikke betales nå.',
  order_already_paid: 'Bestillingen er allerede betalt.',
  payment_method_unavailable: 'Denne betalingsmåten er ikke tilgjengelig akkurat nå. Velg en annen.',
  payment_failed: 'Betalingen ble ikke gjennomført. Ingen penger er trukket. Prøv igjen.',
  payment_provider_error: 'Betalingsleverandøren svarer ikke. Prøv igjen om litt.',
  seat_unavailable: 'Et av setene du valgte er ikke lenger ledig. Velg et annet sete.',
  seats_required: 'Velg seter i salkartet.',
  attendee_names_required: 'Arrangøren krever navn på alle billetter. Fyll inn navn på hver billett.',
  event_cancelled: 'Arrangementet er avlyst.',
  event_ended: 'Arrangementet er over.',

  // Tickets
  ticket_not_transferable: 'Denne billetten kan ikke overføres.',
  ticket_not_resellable: 'Denne billetten kan ikke selges videre.',
  ticket_not_refundable: 'Denne billetten kan ikke refunderes nå.',
  ticket_busy: 'Billetten er allerede lagt ut for salg eller overføring. Avbryt det først.',
  resale_price_too_high: 'Prisen kan ikke være høyere enn det du betalte for billetten.',
  resale_unavailable: 'Billetten er ikke lenger til salgs.',
  own_resale: 'Du kan ikke kjøpe din egen billett.',
  transfer_invalid: 'Overføringslenken er ugyldig eller utløpt.',
  transfer_self: 'Du kan ikke overføre billetten til deg selv.',
  received_ticket_resale: 'Billetter du har fått overført kan ikke selges videre. Be den som kjøpte billetten om å selge den.',

  // Organizer
  organizer_pending: 'Arrangørkontoen din venter på godkjenning.',
  organizer_not_approved: 'Arrangørkontoen må godkjennes før du kan publisere arrangementer.',
  invalid_org_number: 'Organisasjonsnummeret er ikke gyldig. Det skal ha 9 siffer.',
  invalid_account_number: 'Kontonummeret er ikke gyldig. Det skal ha 11 siffer.',
  event_has_sales: 'Kan ikke gjøres etter at billettsalget har startet.',
  capacity_below_sold: 'Kapasiteten kan ikke være lavere enn antall solgte billetter.',
  ticket_type_has_sales: 'Billettypen har solgte billetter og kan ikke slettes. Sett den på pause i stedet.',
  discount_code_exists: 'Det finnes allerede en rabattkode med dette navnet for arrangementet.',
  last_owner: 'Arrangøren må ha minst én eier.',
  member_exists: 'Personen er allerede med i teamet.',
  invalid_scanner_code: 'Koden er feil eller er trukket tilbake.',
  publish_incomplete: 'Legg til minst én billettype før du publiserer.',

  // Account
  last_login_method: 'Du må ha minst én innloggingsmetode.',
  identity_in_use: 'Denne kontoen er allerede koblet til en annen TIKIT-bruker.',
  provider_unavailable: 'Denne innloggingsmetoden er ikke tilgjengelig akkurat nå.',
  login_failed: 'Innloggingen ble avbrutt eller mislyktes. Prøv igjen.',
  account_banned: 'Kontoen er sperret. Ta kontakt med TIKIT for hjelp.',
  has_upcoming_tickets: 'Du har billetter til kommende arrangementer. Overfør eller refunder dem før du sletter kontoen.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

const STATUS: Partial<Record<ErrorCode, number>> = {
  bad_request: 400,
  validation: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  csrf: 403,
  internal: 500,
  unavailable: 503,
  payment_provider_error: 502,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, opts: { message?: string; status?: number; fields?: Record<string, string>; details?: Record<string, unknown> } = {}) {
    super(opts.message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? STATUS[code] ?? 400;
    this.fields = opts.fields;
    this.details = opts.details;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}
