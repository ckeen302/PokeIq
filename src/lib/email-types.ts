/** The signed-in trainer's own email settings, as /api/email/settings returns them. */
export interface EmailSettingsView {
  /** The address on file (private: only ever returned to its owner). */
  email: string | null;
  /** Confirmed through the emailed link. */
  verified: boolean;
  dailyEmail: boolean;
  /** Only on days a streak is at risk. */
  streakNudge: boolean;
  /** With no address on file: the Discord / Google one, to prefill. */
  suggestion: string | null;
}

export const DAILY_EMAIL_OPT_IN = "Email me when new dailies drop";
