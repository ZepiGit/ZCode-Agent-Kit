/**
 * Async (off-peak) types: ticket states, server response shapes, error classes.
 *
 * Server-side response fields are snake_case (e.g. `ticket_id`, `next_poll_after`).
 * The client converts them to camelCase on the way out; callers never see the
 * raw server shape.
 *
 */

/** Ticket lifecycle states reported by the server. */
export type TicketState = "queued" | "ready" | "active" | "settled" | "expired" | "not_found";

export function isTicketReady(s: TicketState): boolean {
  return s === "ready" || s === "active";
}

export function isTicketExpired(s: TicketState): boolean {
  return s === "expired" || s === "not_found";
}

/** Result of `GET /ticket/availability`. */
export interface AvailabilityResult {
  canTakeNumber: boolean;
  /** Unix seconds — earliest time the user can retry taking a number. Present when `canTakeNumber === false`. */
  nextTakeAt?: number;
}

/** Result of `POST /ticket` (take a number). */
export interface TakeTicketResult {
  ticketId: string;
  state: TicketState;
  /** Queue position (1-indexed). Present while `state === "queued"`. */
  position?: number;
  /** Server-suggested next poll delay in ms. Present when server has a backoff recommendation. */
  nextPollAfterMs?: number;
  /** Local timestamp (ms) when the ticket was registered. */
  registeredAt: number;
}

/** Status of a single ticket from `POST /ticket/status`. */
export interface TicketStatusResult {
  ticketId: string;
  state: TicketState;
  position?: number;
  /** Unix seconds — deadline by which the client must use a `ready` ticket. Present on `ready`. */
  activeDeadline?: number;
}

/** Result of `POST /ticket/status` (batch poll). */
export interface BatchStatusResult {
  /** Server-suggested next poll delay in ms (applies to all returned tickets). */
  nextPollAfterMs?: number;
  tickets: TicketStatusResult[];
}

/** Credentials needed to authenticate with the off-peak backend. */
export interface OffPeakCredentials {
  /** ZCode plan JWT — goes in `Authorization: Bearer ${jwt}`. Source: `Credential.jwt`. */
  jwt: string;
  /** Coding-plan API key — goes in `X-Coding-Plan-Api-Key`. Source: `Credential.apiKey`. */
  codingPlanApiKey: string;
  /** Optional Bigmodel-team org/project headers. */
  bigmodelOrganization?: string;
  bigmodelProject?: string;
}

/** HTTP-status-bearing error from the off-peak server. */
export class OffPeakServerError extends Error {
  readonly httpStatus: number;
  readonly bizCode?: string;
  constructor(message: string, httpStatus: number, bizCode?: string) {
    super(message);
    this.name = "OffPeakServerError";
    this.httpStatus = httpStatus;
    this.bizCode = bizCode;
  }
}

/** Thrown when credentials lack the JWT required for off-peak auth. */
export class OffPeakCredentialsUnavailableError extends Error {
  constructor(message: string = "off-peak requires a logged-in oauth credential (jwt missing)") {
    super(message);
    this.name = "OffPeakCredentialsUnavailableError";
  }
}
