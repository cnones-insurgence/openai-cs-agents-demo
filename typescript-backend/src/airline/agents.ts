import { Agent } from "@openai/agents";
import { RECOMMENDED_PROMPT_PREFIX } from "@openai/agents-core/extensions";
import { jailbreakGuardrail, relevanceGuardrail } from "./guardrails.js";
import { assignSpecialServiceSeat, bookNewFlight, cancelFlight, displaySeatMap, faqLookupTool, flightStatusTool, getMatchingFlights, getTripDetails, issueCompensation, updateSeat } from "./tools.js";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";

export const seatSpecialServicesAgent = new Agent({
  name: "Seat and Special Services Agent",
  model: MODEL,
  handoffDescription: "Updates seats and handles medical or special service seating.",
  instructions: `${RECOMMENDED_PROMPT_PREFIX}
You are the Seat & Special Services Agent. Handle seat changes and medical/special service requests.
1. If confirmation/flight/seat are missing, ask to confirm. If present, act without re-asking.
2. Offer seat map or specific seat. Use assign_special_service_seat for front row/medical requests, update_seat for standard changes, display_seat_map for visual choice.
3. Confirm new seat is saved on confirmation.
Important: if request is clear and data is present, perform multiple tool calls in a single turn without waiting.
When done, emit at most one handoff: Refunds & Compensation if disruption support is pending, otherwise Triage.
If unrelated to seats/special services, transfer to Triage.`,
  tools: [updateSeat, assignSpecialServiceSeat, displaySeatMap],
  inputGuardrails: [relevanceGuardrail, jailbreakGuardrail]
});

export const flightInformationAgent = new Agent({
  name: "Flight Information Agent",
  model: MODEL,
  handoffDescription: "Provides flight status, connection impact, and alternate options.",
  instructions: `${RECOMMENDED_PROMPT_PREFIX}
You are the Flight Information Agent. Provide status, connection risk, and quick options.
1. If confirmation/flight are missing, infer from context or ask once.
2. Use flight_status_tool immediately and note missed-connection risk.
3. If delay/cancellation impacts trip, call get_matching_flights and hand off to Booking and Cancellation Agent.
Chain tool calls autonomously; emit a single handoff per message.`,
  tools: [flightStatusTool, getMatchingFlights],
  inputGuardrails: [relevanceGuardrail, jailbreakGuardrail]
});

export const bookingCancellationAgent = new Agent({
  name: "Booking and Cancellation Agent",
  model: MODEL,
  handoffDescription: "Handles new bookings, rebookings after delays, and cancellations.",
  instructions: `${RECOMMENDED_PROMPT_PREFIX}
You are the Booking & Cancellation Agent. Handle cancel, book, and rebook.
1. Work from confirmation/flight if present; ask only if critical info is missing.
2. For new flight, call get_matching_flights (if needed), then book_new_flight and auto-assign seat.
3. For cancellation, use cancel_flight.
4. Summarize what changed with confirmation and seat.
Execute autonomously with multiple tool calls when data exists; emit one handoff per message.`,
  tools: [cancelFlight, getMatchingFlights, bookNewFlight],
  inputGuardrails: [relevanceGuardrail, jailbreakGuardrail]
});

export const refundsCompensationAgent = new Agent({
  name: "Refunds and Compensation Agent",
  model: MODEL,
  handoffDescription: "Opens compensation cases and issues hotel/meal support after delays.",
  instructions: `${RECOMMENDED_PROMPT_PREFIX}
You are the Refunds & Compensation Agent.
1. Work from confirmation; ask for it only if missing.
2. For delay/missed connection, consult policy via faq_lookup_tool, then use issue_compensation for case + vouchers.
3. Confirm what was issued and what receipts to keep.
Operate autonomously with chained tool calls and one handoff per message.`,
  tools: [issueCompensation, faqLookupTool],
  inputGuardrails: [relevanceGuardrail, jailbreakGuardrail]
});

export const faqAgent = new Agent({
  name: "FAQ Agent",
  model: MODEL,
  handoffDescription: "Answers common questions about policies, baggage, seats, and compensation.",
  instructions: `${RECOMMENDED_PROMPT_PREFIX}
You are an FAQ agent.
1. Identify the latest user question.
2. Use faq_lookup_tool to answer (do not rely on your own knowledge).
3. Offer transfer to the right agent if compensation/support is needed.`,
  tools: [faqLookupTool],
  inputGuardrails: [relevanceGuardrail, jailbreakGuardrail]
});

export const triageAgent = Agent.create({
  name: "Triage Agent",
  model: MODEL,
  handoffDescription: "Delegates requests to the right specialist agent.",
  instructions: `${RECOMMENDED_PROMPT_PREFIX}
You are a helpful triaging agent. Route to the best specialist:
Flight Information for status/alternates, Booking and Cancellation for booking changes, Seat and Special Services for seating, FAQ for policy, Refunds and Compensation for disruption support.
If message mentions Paris/New York/Austin and context is missing, call get_trip_details first.
If request is clear, hand off immediately and let specialist complete multi-step work.
Never emit more than one handoff per message.`,
  tools: [getTripDetails],
  handoffs: [flightInformationAgent, bookingCancellationAgent, seatSpecialServicesAgent, faqAgent, refundsCompensationAgent],
  inputGuardrails: [relevanceGuardrail, jailbreakGuardrail]
});

faqAgent.handoffs = [triageAgent];
seatSpecialServicesAgent.handoffs = [refundsCompensationAgent, triageAgent];
flightInformationAgent.handoffs = [bookingCancellationAgent, triageAgent];
bookingCancellationAgent.handoffs = [seatSpecialServicesAgent, refundsCompensationAgent, triageAgent];
refundsCompensationAgent.handoffs = [faqAgent, triageAgent];

export const agentMap = {
  "Triage Agent": triageAgent,
  "Flight Information Agent": flightInformationAgent,
  "Booking and Cancellation Agent": bookingCancellationAgent,
  "Seat and Special Services Agent": seatSpecialServicesAgent,
  "FAQ Agent": faqAgent,
  "Refunds and Compensation Agent": refundsCompensationAgent
} as const;
