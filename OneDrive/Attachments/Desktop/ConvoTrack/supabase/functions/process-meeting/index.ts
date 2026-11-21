
import {
  authenticate,
  corsPreflight,
  errorMessage,
  json,
  supabase,
} from "../_shared/ai-engine/common.ts";

import { transcribeMeeting } from "../_shared/ai-engine/transcribe.ts";
import { buildMeetingContext } from "../_shared/ai-engine/context.ts";
import { extractMeetingActions } from "../_shared/ai-engine/extractor.ts";
import { saveActionWithHITL } from "../_shared/ai-engine/hitl.ts";

Deno.serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const user = await authenticate(req);

    const body = await req.json();

    const meetingId = body.meeting_id;

    if (!meetingId) {
      return json({ error: "meeting_id is required" }, 400);
    }

    // 1. Get the meeting.
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("*")
      .eq("id", meetingId)
      .eq("created_by", user.id)
      .single();

    if (meetingError || !meeting) {
      return json({ error: "Meeting not found" }, 404);
    }

    // 2. Transcribe audio or use existing transcript.
    const transcript = await transcribeMeeting(
      meeting.id,
      meeting.transcript,
      meeting.audio_path,
    );

    // 3. Save transcript.
    const { error: transcriptError } = await supabase
      .from("meetings")
      .update({ transcript })
      .eq("id", meeting.id)
      .eq("created_by", user.id);

    if (transcriptError) {
      throw new Error(transcriptError.message);
    }

    // 4. Build historical context.
    const context = await buildMeetingContext(
      meeting.id,
      user.id,
      transcript,
    );

    // 5. Extract decisions and actions.
    const analysis = await extractMeetingActions(
      transcript,
      meeting.created_at,
      context,
    );

    // 6. Save decisions.
    const savedDecisions = [];

    for (const decision of analysis.decisions) {
      const { data, error } = await supabase
        .from("decisions")
        .insert({
          meeting_id: meeting.id,
          summary: decision.summary,
          ai_reasoning: decision.ai_reasoning,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      savedDecisions.push(data);
    }

    // 7. Apply updates to existing tasks.
    const updatedTasks = [];

    for (const update of analysis.task_updates) {
      const statusMap: Record<string, string> = {
        completed: "done",
        in_progress: "in_progress",
        reopened: "open",
      };

      // Cancellation is not part of the supplied status constraint.
      if (update.update_type === "cancelled") continue;

      const { data, error } = await supabase
        .from("action_items")
        .update({
          status: statusMap[update.update_type],
        })
        .eq("id", update.existing_action_item_id)
        .in("status", ["open", "in_progress"])
        .select()
        .maybeSingle();

      if (error) throw new Error(error.message);

      if (data) updatedTasks.push(data);
    }

    // 8. Save new action items through the HITL gate.
    const savedActions = [];

    for (const item of analysis.action_items) {
      // Prevent exact-title duplicates in existing commitments.
      const duplicate = context.activeTasks.find(
        (task: any) =>
          task.title.toLowerCase().trim() ===
          item.title.toLowerCase().trim(),
      );

      if (duplicate) continue;

      const action = await saveActionWithHITL(
        meeting.id,
        item,
      );

      savedActions.push(action);
    }

    return json({
      success: true,
      meeting_id: meeting.id,
      transcript,
      decisions: savedDecisions,
      action_items: savedActions,
      updated_tasks: updatedTasks,
      statistics: {
        decisions: savedDecisions.length,
        new_actions: savedActions.length,
        updated_tasks: updatedTasks.length,
        clarifications_required: savedActions.filter(
          (item) => item.status === "needs_clarification",
        ).length,
      },
    });
  } catch (error) {
    console.error("Process meeting error:", error);

    return json({
      success: false,
      error: errorMessage(error),
    }, 500);
  }
});
