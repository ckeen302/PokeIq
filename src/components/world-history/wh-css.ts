/** The text version's look: the museum serif, each chapter's accent, quotes ruled in it. */
export const WH_TEXT_CSS = `
.wh-serif{font-family:var(--font-wh-serif),Georgia,"Times New Roman",serif}
.wh-accent{color:var(--wh-accent,hsl(var(--primary)))}
.wh-ch-head{background:radial-gradient(90% 140% at 0% 0%,color-mix(in srgb,var(--wh-accent) 18%,transparent),transparent 62%)}
.wh-ch{border-color:color-mix(in srgb,var(--wh-accent) 22%,hsl(var(--border)))}
.wh-quote{padding-left:1rem;border-left:2px solid color-mix(in srgb,var(--wh-accent) 70%,transparent)}
`;
