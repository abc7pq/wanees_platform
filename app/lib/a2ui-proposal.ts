// Reads the proposal id from an A2UI surface without loading the A2UI validator (zod), so the
// visitor page can check it while the surface renderer itself loads on demand.
import type { A2uiMessage } from "./a2ui.ts";

/** The proposal id a surface's data model carries, or null when it is not a proposal surface. */
export function surfaceProposalId(messages: readonly A2uiMessage[] | null | undefined) {
  const create = messages?.find((message) => "createSurface" in message);
  const proposal = create && "createSurface" in create ? (create.createSurface.dataModel as { proposal?: { id?: unknown } } | undefined)?.proposal : undefined;
  return typeof proposal?.id === "string" ? proposal.id : null;
}
