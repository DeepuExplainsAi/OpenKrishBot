export interface PipelineStep { bot: string; task: string }

/** The message for step `i` of a crewAI-style sequential pipeline: do your task, then hand the result to the next bot (or back to the starter). */
export function stepMessage(steps: PipelineStep[], i: number, starter: string): string {
  const next = steps[i + 1];
  const rest = steps.slice(i + 1);
  const handoff = next
    ? `When done, call send_to_bot to "${next.bot}" with your result and this pipeline:\n${JSON.stringify(rest)}\nTell them: "Pipeline step ${i + 2} of ${steps.length}. Do the task below with the result above, then forward as instructed."`
    : `When done, call send_to_bot to "${starter}" with the final result.`;
  return `[Pipeline step ${i + 1} of ${steps.length}]\nTask: ${steps[i].task}\n\n${handoff}`;
}
