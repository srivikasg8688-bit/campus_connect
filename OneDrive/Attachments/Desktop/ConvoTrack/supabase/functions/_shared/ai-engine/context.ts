
import { supabase, createEmbedding } from "./common.ts";

export interface MeetingContext {
  similarMeetings: unknown[];
  activeTasks: unknown[];
}

export async function buildMeetingContext(
  meetingId: string,
  createdBy: string,
  transcript: string,
): Promise<MeetingContext> {
  const embedding = await createEmbedding(transcript);

  // Save the current meeting embedding.
  const { error: updateError } = await supabase
    .from("meetings")
    .update({ embedding })
    .eq("id", meetingId)
    .eq("created_by", createdBy);

  if (updateError) {
    throw new Error(`Embedding save failed: ${updateError.message}`);
  }

  // Retrieve the three most similar previous meetings.
  const { data: similarMeetings, error: matchError } =
    await supabase.rpc("match_meetings", {
      query_embedding: embedding,
      match_count: 3,
      filter_user_id: createdBy,
      exclude_meeting_id: meetingId,
    });

  if (matchError) {
    throw new Error(`Meeting context failed: ${matchError.message}`);
  }

  // Retrieve current commitments.
  const { data: activeTasks, error: taskError } = await supabase
    .from("action_items")
    .select(`
      id,
      meeting_id,
      title,
      owner_email,
      due_at,
      priority,
      status,
      confidence,
      ai_reasoning,
      depends_on
    `)
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(100);

  if (taskError) {
    throw new Error(`Active task retrieval failed: ${taskError.message}`);
  }

  // Only include tasks from meetings belonging to this user.
  const { data: ownedMeetings, error: ownedError } = await supabase
    .from("meetings")
    .select("id")
    .eq("created_by", createdBy);

  if (ownedError) {
    throw new Error(`Meeting ownership lookup failed: ${ownedError.message}`);
  }

  const ownedIds = new Set(
    (ownedMeetings || []).map((meeting) => meeting.id),
  );

  const filteredTasks = (activeTasks || []).filter(
    (task) => ownedIds.has(task.meeting_id),
  );

  return {
    similarMeetings: similarMeetings || [],
    activeTasks: filteredTasks,
  };
}
