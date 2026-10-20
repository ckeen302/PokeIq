"use client";

import { useEffect, useState } from "react";
import { FeedbackForm } from "./FeedbackForm";

/** /feedback's form, about the page the player came from (when it's one of ours). */
export function FeedbackPage() {
  const [page, setPage] = useState<string | null>(null);
  useEffect(() => {
    let from = "/feedback";
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.origin === location.origin && ref.pathname !== "/feedback") from = `${ref.pathname}${ref.search}`.slice(0, 500);
    } catch {
      // keep /feedback
    }
    setPage(from);
  }, []);
  return page === null ? null : <FeedbackForm page={page} />;
}
