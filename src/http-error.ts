// An error whose message is meant for the phone, with the HTTP status it answers with.
// Anything else that escapes a request is a fault: the phone gets a generic 500 and the
// details go to the host's log.
export class HttpError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
