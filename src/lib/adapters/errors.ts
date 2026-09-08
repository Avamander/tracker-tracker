// src/lib/adapters/errors.ts
//
// Classes: SessionExpiredError

/**
 * An authenticated request came back as a login page, or was bounced to one.
 *
 * The retry in torrentleech.ts and the enrichment rethrow in digitalcore.ts
 * both need to recognise this case, and both used to do it by matching the
 * message text. That made a user-facing string load-bearing: rewording it to
 * say which credentials to check would have silently disabled the retry.
 *
 * The message stays whatever the caller passes, since it is what the user
 * reads on the tracker card; only the recognition moves off it.
 */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SessionExpiredError"
  }
}
