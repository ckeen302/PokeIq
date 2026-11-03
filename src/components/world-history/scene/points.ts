/** Up to n points spread over a relief mesh's front sheet (the first half of its vertices), for particle effects. */
export function samplePoints(position: Float32Array, n: number, seed = 7): Float32Array {
  const front = position.length / 6;
  const out = new Float32Array(Math.min(n, Math.max(0, Math.floor(front))) * 3);
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < out.length / 3; i++) {
    const v = Math.floor(rnd() * front);
    out[i * 3] = position[v * 3];
    out[i * 3 + 1] = position[v * 3 + 1];
    out[i * 3 + 2] = position[v * 3 + 2];
  }
  return out;
}
