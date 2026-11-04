import { PASS_S, PASSES, STAGGER_S } from '../particleTiming'

/**
 * Particles that travel along the edge that leads to the working node, to say "this step is working right now". The movement is
 * finite: it plays for under 5 seconds and stops, the node then keeps its static ring. It starts again only when the edge is drawn
 * again, i.e. when the work moves to another step (the caller keys this component on the step). It is listed as a documented
 * deviation in YOLEA.md (sogoma-check S02 exclusion). Not rendered under reduced motion.
 */
export function ConstellationParticles({ d }: { d: string }) {
  return (
    <>
      {[0, 1, 2].map((k) => (
        <circle key={k} className="rc-particle" r="3.5">
          <animateMotion dur={`${PASS_S}s`} begin={`${k * STAGGER_S}s`} repeatCount={PASSES} path={d} />
          {/* After its last trip a particle would sit at the origin of the drawing: it is hidden instead. */}
          <set attributeName="display" to="none" begin={`${k * STAGGER_S + PASSES * PASS_S}s`} />
        </circle>
      ))}
    </>
  )
}
