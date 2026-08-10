/**
 * The PokéIQ mark: a Master Ball whose top hemisphere is a psychic brain.
 * Pure inline SVG — crisp at any size, no asset requests.
 */
export function BrainLogo({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
      role="img"
    >
      <defs>
        <linearGradient id="biq-brain" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e9d5ff" />
          <stop offset="0.5" stopColor="#c084fc" />
          <stop offset="1" stopColor="#9333ea" />
        </linearGradient>
        <clipPath id="biq-ball">
          <circle cx="32" cy="32" r="21" />
        </clipPath>
      </defs>

      {/* ball body */}
      <circle cx="32" cy="32" r="21" fill="#f8fafc" />

      {/* top hemisphere = psychic brain, Master Ball violet */}
      <g clipPath="url(#biq-ball)">
        <rect x="11" y="11" width="42" height="21" fill="url(#biq-brain)" />
        {/* cortex bumps along the band */}
        <g fill="url(#biq-brain)">
          <circle cx="15" cy="29" r="5" />
          <circle cx="22" cy="30" r="5.5" />
          <circle cx="29" cy="29" r="5" />
          <circle cx="37" cy="30" r="5.5" />
          <circle cx="44" cy="29" r="5" />
          <circle cx="50" cy="30" r="4.5" />
        </g>
        {/* central fissure */}
        <path
          d="M32 11c-2 3 2 5 0 8s2 5 0 8"
          stroke="#6b21a8"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
          opacity="0.75"
        />
        {/* gyri squiggles */}
        <path
          d="M15 24c3-2 5 1 8-1s4 1 6-1M35 22c3-2 5 1 8-1s4 1 6 0M18 17c3-1 4 2 7 1M38 16c3-1 4 2 7 1"
          stroke="#6b21a8"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
          opacity="0.6"
        />
        {/* small Master Ball "M" crest, top-center */}
        <path
          d="M27 15v6l2.5-3.5L32 21l2.5-3.5L37 21v-6"
          stroke="#f9a8d4"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.9"
        />
      </g>

      {/* band — deep violet, Master Ball style */}
      <path
        d="M11.3 35.5h41.4a21 21 0 0 0 0-7H11.3a21 21 0 0 0 0 7Z"
        fill="#2e1065"
        transform="translate(0 2)"
      />

      {/* button — pink core, matching the Master Ball's signature dot */}
      <circle cx="32" cy="34" r="7.5" fill="#2e1065" />
      <circle cx="32" cy="34" r="5" fill="#fce7f3" />
      <circle cx="32" cy="34" r="2.2" fill="#ec4899" />

      {/* outer ring */}
      <circle
        cx="32"
        cy="32"
        r="21"
        fill="none"
        stroke="#2e1065"
        strokeWidth="2.5"
      />
    </svg>
  );
}
