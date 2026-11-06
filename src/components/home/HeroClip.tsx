"use client";

import { useEffect, useRef, useState } from "react";
import { getImageProps } from "next/image";
import { cn } from "@/lib/utils";
import type { SectionClip } from "./sections";

/** Phones get the 4:5 cut, recorded at a phone's layout; wider screens the 16:9 one. */
export const PHONE_MEDIA = "(max-width: 639px)";
const AV1 = 'video/mp4; codecs="av01.0.08M.08"';
const H264 = 'video/mp4; codecs="avc1.640028"';

/** AV1 where the browser plays it (smaller), else H.264; null when it plays neither. */
function pickCodec(): "av1" | "h264" | null {
  const v = document.createElement("video");
  if (v.canPlayType(AV1)) return "av1";
  return v.canPlayType(H264) || v.canPlayType("video/mp4") ? "h264" : null;
}

/**
 * A slide's clip on the title screen: its poster (the clip's first frame) as
 * a picture, art-directed for phones, and over it the clip itself once it's
 * allowed to load. The video only exists for the slide on screen and the one
 * coming next (`load`), only fetches in full when it's the one on screen
 * (`active`), plays muted and inline while `run`, and fades in over its
 * poster once it really plays, so there's never a blank or a jump. A clip
 * that fails, a reduced-motion or data-saving visitor, keep the poster.
 * `onPlayed` counts the times the clip has played through.
 */
export function HeroClip({
  clip,
  active,
  load,
  run,
  priority = false,
  posterReady,
  onPlayed,
}: {
  clip: SectionClip;
  /** On screen. */
  active: boolean;
  /** May have its video element (on screen, or next up). */
  load: boolean;
  /** Should play now (on screen, the slideshow playing, the page visible). */
  run: boolean;
  /** The page's hero image: server-rendered, fetched first. */
  priority?: boolean;
  /** The poster may load (the first slide's always does). */
  posterReady: boolean;
  onPlayed?: (times: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [phone, setPhone] = useState<boolean | null>(null);
  const [codec, setCodec] = useState<"av1" | "h264" | null>(null);
  const [still, setStill] = useState(true);
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const played = useRef(0);
  const last = useRef(0);
  const onPlayedRef = useRef(onPlayed);
  useEffect(() => {
    onPlayedRef.current = onPlayed;
  });

  // Which cut, and whether moving pictures are wanted at all.
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MEDIA);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setPhone(mq.matches);
      const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      setStill(reduce.matches || conn?.saveData === true);
    };
    sync();
    setCodec(pickCodec());
    mq.addEventListener("change", sync);
    reduce.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      reduce.removeEventListener("change", sync);
    };
  }, []);

  const cut = phone ? clip.phone : clip.desktop;
  const src = codec === "av1" ? cut.av1 : cut.video;
  const wantVideo = load && !failed && phone !== null && codec !== null && (!still || run);

  // Play while it should; otherwise hold the frame it's on.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (run && active) {
      const p = v.play();
      if (p) p.catch(() => undefined);
    } else v.pause();
  }, [run, active, wantVideo, src]);

  // Back on screen: from the top, counted afresh.
  useEffect(() => {
    if (!active) return;
    played.current = 0;
    last.current = 0;
    const v = video.current;
    if (v && v.currentTime > 0) v.currentTime = 0;
  }, [active]);

  // A new cut (a phone turned, a window resized across the line) starts hidden again.
  useEffect(() => setShown(false), [src]);

  const position = clip.position ?? "center";
  const common = { alt: clip.alt, sizes: "(min-width: 1152px) 1152px, 100vw", loading: "eager" as const, fetchPriority: priority ? ("high" as const) : ("low" as const) };
  const desktop = getImageProps({ ...common, src: clip.desktop.poster, width: clip.desktop.width, height: clip.desktop.height }).props;
  const mobile = getImageProps({ ...common, sizes: "100vw", src: clip.phone.poster, width: clip.phone.width, height: clip.phone.height }).props;

  return (
    <div className="absolute inset-0" data-testid="hero-clip">
      {posterReady && (
        <picture>
          <source media={PHONE_MEDIA} srcSet={mobile.srcSet} sizes={mobile.sizes} width={clip.phone.width} height={clip.phone.height} />
          {/* eslint-disable-next-line jsx-a11y/alt-text -- the alt comes in the props */}
          <img {...desktop} className="absolute inset-0 h-full w-full select-none object-cover" style={{ objectPosition: position }} data-testid="hero-poster" draggable={false} />
        </picture>
      )}
      {wantVideo && (
        <video
          ref={video}
          key={src}
          src={src}
          muted
          playsInline
          loop
          disablePictureInPicture
          preload={active ? "auto" : "metadata"}
          aria-hidden
          tabIndex={-1}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-300 motion-reduce:transition-none", shown ? "opacity-100" : "opacity-0")}
          style={{ objectPosition: position }}
          data-testid="hero-video"
          data-playing={shown ? "true" : "false"}
          onPlaying={() => setShown(true)}
          onError={() => setFailed(true)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            // The loop wrapped round: one more play through.
            if (t + 0.5 < last.current) {
              played.current += 1;
              onPlayedRef.current?.(played.current);
            }
            last.current = t;
          }}
        />
      )}
    </div>
  );
}
