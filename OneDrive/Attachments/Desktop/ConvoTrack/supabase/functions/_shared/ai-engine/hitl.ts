
import {
  isValidDate,
  normalizeEmail,
  supabase,
} from "./common.ts";

import type { ExtractedAction } from "./extractor.ts";

export async function saveActionWithHITL(
  meetingId: string,
  item: ExtractedAction,
) {
  const owner = normalizeEmail(item.owner_email);

  const validDeadline = isValidDate(item.due_at);

  const needsClarification =
    item.confidence < 0.75 ||
    !owner ||
    !validDeadline;

  const status = needsClarification
    ? "needs_clarification"
    : "open";

  const { data: action, error } = await supabase
    .from("action_items")
    .insert({
      meeting_id: meetingId,
      title: item.title,
      owner_email: owner,
      due_at: validDeadline ? item.due_at : null,
      priority: item.priority,
      status,
      confidence: item.confidence,
      ai_reasoning: item.ai_reasoning,
      depends_on: null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Action insertion failed: ${error.message}`);
  }

  if (item.depends_on_title) {
    const { data: candidates } = await supabase
      .from("action_items")
      .select("id, title")
      .eq("meeting_id", meetingId)
      .neq("id", action.id);

    const dependency = (candidates || []).find(
      (candidate) =>
        candidate.title.toLowerCase().trim() ===
        item.depends_on_title!.toLowerCase().trim(),
    );

    if (dependency) {
      const { error: dependencyError } = await supabase
        .from("action_items")
        .update({ depends_on: dependency.id })
        .eq("id", action.id);

      if (dependencyError) {
        throw new Error(dependencyError.message);
      }
    }
  }

  if (needsClarification) {
    let question = item.clarification_question;

    if (!question) {
      if (!owner) {
        question = `Who is responsible for "${item.title}"? Please provide their email address.`;
      } else if (!validDeadline) {
        question = `What is the exact deadline for "${item.title}"?`;
      } else {
        question = `Can you confirm the commitment "${item.title}"?`;
      }
    }

    const { error: clarificationError } = await supabase
      .from("clarifications")
      .insert({
        action_item_id: action.id,
        question,
        resolved: false,
      });

    if (clarificationError) {
      throw new Error(clarificationError.message);
    }
  }

  return action;
}
