
import {
  askLLM,
  isDueWithin24Hours,
  isValidDate,
  supabase,
} from "./common.ts";

const reminderSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: { type: "string" },
  },
  required: ["message"],
};

export async function runFollowupEngine() {
  const now = new Date();

  const { data: tasks, error } = await supabase
    .from("action_items")
    .select(`
      id,
      meeting_id,
      title,
      owner_email,
      due_at,
      priority,
      status,
      depends_on,
      meetings (
        title,
        transcript
      )
    `)
    .in("status", ["open", "in_progress"])
    .not("due_at", "is", null)
    .lte(
      "due_at",
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    );

  if (error) {
    throw new Error(`Follow-up query failed: ${error.message}`);
  }

  const results = {
    processed: 0,
    sent: 0,
    skipped: [] as { task_id: string; reason: string }[],
  };

  for (const task of tasks || []) {
    if (!isValidDate(task.due_at) || !isDueWithin24Hours(task.due_at)) {
      continue;
    }

    // Skip tasks that have already received a reminder.
    const { data: previous } = await supabase
      .from("followups")
      .select("id")
      .eq("action_item_id", task.id)
      .gte(
        "sent_at",
        new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      )
      .limit(1);

    if (previous?.length) {
      results.skipped.push({
        task_id: task.id,
        reason: "Reminder already sent within 24 hours",
      });
      continue;
    }

    // Check dependencies.
    if (task.depends_on) {
      const { data: blocker } = await supabase
        .from("action_items")
        .select("id, title, status")
        .eq("id", task.depends_on)
        .maybeSingle();

      if (blocker && blocker.status !== "done") {
        results.skipped.push({
          task_id: task.id,
          reason: `Blocked by unfinished task: ${blocker.title}`,
        });
        continue;
      }
    }

    results.processed++;

    const meeting = Array.isArray(task.meetings)
      ? task.meetings[0]
      : task.meetings;

    const systemPrompt = `
You are a professional meeting follow-up assistant.

Write a short, polite, specific reminder.

Mention the task, deadline, and relevant original meeting decision.
Do not invent details.
Do not use aggressive language.
Return only the requested JSON.
`;

    const prompt = `
TASK: ${task.title}
OWNER: ${task.owner_email}
DEADLINE: ${task.due_at}
PRIORITY: ${task.priority}

ORIGINAL MEETING: ${meeting?.title || "Meeting"}
ORIGINAL TRANSCRIPT: ${(meeting?.transcript || "").slice(0, 5000)}

Write a concise reminder.
`;

    const draft = await askLLM<{ message: string }>(
      systemPrompt,
      prompt,
      "followup_message",
      reminderSchema,
    );

    const webhook = Deno.env.get("FOLLOWUP_WEBHOOK_URL");

    // Log the reminder before attempting delivery.
    const { error: logError } = await supabase
      .from("followups")
      .insert({
        action_item_id: task.id,
        channel: Deno.env.get("FOLLOWUP_WEBHOOK_CHANNEL") || "webhook",
        message: draft.message,
        sent_at: now.toISOString(),
      });

    if (logError) {
      throw new Error(`Follow-up logging failed: ${logError.message}`);
    }

    if (!webhook) {
      results.skipped.push({
        task_id: task.id,
        reason: "Webhook is not configured; reminder logged only",
      });
      continue;
    }

    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: draft.message,
        message: draft.message,
        task_id: task.id,
        owner_email: task.owner_email,
      }),
    });

    if (!response.ok) {
      results.skipped.push({
        task_id: task.id,
        reason: `Webhook delivery failed: ${response.status}`,
      });
      continue;
    }

    results.sent++;
  }

  return results;
}
