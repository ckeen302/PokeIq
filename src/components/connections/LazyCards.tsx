"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

/**
 * The cards under the board (duel, ranked, party): their code loads only
 * when the player scrolls near them (or follows a #duel link), so the
 * board's own JavaScript arrives first. Each keeps its anchor and a box of
 * about its height while it loads, so nothing below it jumps.
 */

const Placeholder = ({ minH }: { minH: string }) => <div className="animate-pulse rounded-lg border border-foreground/10 bg-card/60" style={{ minHeight: minH }} aria-hidden />;

const DuelCard = dynamic(() => import("./ConnectionsDuelCard").then((m) => m.ConnectionsDuelCard), { ssr: false, loading: () => <Placeholder minH="17rem" /> });
const RankedCard = dynamic(() => import("./ConnectionsRanked").then((m) => m.ConnectionsRankedCard), { ssr: false, loading: () => <Placeholder minH="15rem" /> });
const PartyCard = dynamic(() => import("./ConnectionsParty").then((m) => m.ConnectionsPartyCard), { ssr: false, loading: () => <Placeholder minH="12rem" /> });

/** Renders `children` once the box is within a screen of the viewport (at once when the URL points at it). */
function WhenNear({ id, minH, children }: { id: string; minH: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (window.location.hash === `#${id}` || typeof IntersectionObserver === "undefined") return setNear(true);
    const onHash = () => window.location.hash === `#${id}` && setNear(true);
    window.addEventListener("hashchange", onHash);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "100% 0px" });
    if (ref.current) io.observe(ref.current);
    return () => {
      io.disconnect();
      window.removeEventListener("hashchange", onHash);
    };
  }, [id]);
  return (
    <div id={id} ref={ref} className="mx-auto max-w-3xl scroll-mt-24">
      {near ? children : <Placeholder minH={minH} />}
    </div>
  );
}

export function ConnectionsLazyCards() {
  return (
    <>
      <WhenNear id="duel" minH="17rem">
        <DuelCard />
      </WhenNear>
      <WhenNear id="ranked" minH="15rem">
        <RankedCard />
      </WhenNear>
      <WhenNear id="party" minH="12rem">
        <PartyCard />
      </WhenNear>
    </>
  );
}
