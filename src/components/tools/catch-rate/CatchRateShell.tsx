"use client";

import CatchRateApp, { type CatchRateAppProps } from "./CatchRateApp";

/** The calculator, rendered on the server too (plain maths): the page's HTML already shows the ranking. */
export function CatchRateShell(props: CatchRateAppProps) {
  return <CatchRateApp {...props} />;
}
