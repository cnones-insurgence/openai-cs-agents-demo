export type AirlineContext = {
  passenger_name: string | null;
  confirmation_number: string | null;
  seat_number: string | null;
  flight_number: string | null;
  account_number: string | null;
  itinerary: Array<Record<string, string>> | null;
  baggage_claim_id: string | null;
  compensation_case_id: string | null;
  scenario: string | null;
  vouchers: string[] | null;
  special_service_note: string | null;
  origin: string | null;
  destination: string | null;
};

export function createInitialContext(): AirlineContext {
  return {
    passenger_name: null,
    confirmation_number: null,
    seat_number: null,
    flight_number: null,
    account_number: null,
    itinerary: null,
    baggage_claim_id: null,
    compensation_case_id: null,
    scenario: null,
    vouchers: null,
    special_service_note: null,
    origin: null,
    destination: null
  };
}

export function publicContext(ctx: AirlineContext): Record<string, unknown> {
  const out: Record<string, unknown> = { ...ctx };
  delete out.itinerary;
  delete out.baggage_claim_id;
  delete out.compensation_case_id;
  delete out.scenario;
  if (!out.vouchers || (Array.isArray(out.vouchers) && out.vouchers.length === 0)) {
    delete out.vouchers;
  }
  return out;
}
