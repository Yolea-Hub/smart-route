// Timing of the particles that run to a working node (WCAG 2.2.2: moving content that lasts more than 5 s must be stoppable, so it ends before).

/** Seconds of one trip along the edge. */
export const PASS_S = 1.3
/** Seconds between the starts of two particles. */
export const STAGGER_S = 0.4
/** Trips each particle makes. */
export const PASSES = 3
/** Seconds from the mount to the end of the last particle (three particles: the last one starts 2 x STAGGER_S late). */
export const PARTICLES_TOTAL_S = 2 * STAGGER_S + PASSES * PASS_S
