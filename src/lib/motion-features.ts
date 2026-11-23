import { domMax } from "framer-motion";

/**
 * framer-motion's animation features (animations, gestures, in-view, shared layout), loaded on their own after the
 * page starts: components under a <LazyMotion features={() => import("@/lib/motion-features").then((m) => m.default)}>
 * use the light `m` components, which draw exactly as `motion` does once these arrive.
 */
export default domMax;
