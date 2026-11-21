
import {
  askLLM,
  authenticate,
  corsPreflight,
  errorMessage,
  isValidDate,
  json,
  normalizeEmail,
  supabase,
} from "../_shared/ai-engine/common.ts";

const clarificationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    owner_email: { type: ["string", "null"] },
    due_at: { type: ["string", "null"] },
    priority: {
      type: ["string", "null"],
      enum: ["low", "medium", "high", null],
    },
  },
  required: ["owner_email", "due_at", "priority"],
};

Deno.serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const user = await authenticate(req);
    const body = await req.json();

    const { clarification_id, answer } = body;

    if (
      typeof clarification_id !== "string" ||
      typeof answer !== "string" ||
      !answer.trim()
    ) {
      return json({
        error: "clarification_id and answer are required",
      }, 400);
    }

    // Fetch clarification and its associated action item.
    const { data: clarification, error } = await supabase
      .from("clarifications")
      .select(`
        id,
        question,
        resolved,
        action_items!inner (
          id,
          title,
          owner_email,
          due_at,
          priority,
          status,
          meeting_id
        )
      `)
      .eq("id", clarification_id)
      .eq("resolved", false)
      .single();

    if (error || !clarification) {
      return json({ error: "Clarification not found" }, 404);
    }

    const action = Array.isArray(clarification.action_items)
      ? clarification.action_items[0]
      : clarification.action_items;

    const { data: ownedMeeting } = await supabase
      .from("meetings")
      .select("id")
      .eq("id", action.meeting_id)
      .eq("created_by", user.id)
      .maybeSingle();

    if (!ownedMeeting) {
      return json({ error: "Unauthorized" }, 403);
    }

    const parsed = await askLLM<{
      owner_email: string | null;
      due_at: string | null;
      priority: "low" | "medium" | "high" | null;
    }>(
      `
You interpret human clarification answers for meeting action items.

Only extract information explicitly supplied by the human.
Never invent email addresses or deadlines.
Resolve relative dates using the current date and UTC timezone.
Return null when a field is not provided.
Return ISO-8601 timestamps for unambiguous deadlines.
`,
      `
CURRENT DATE: ${new Date().toISOString()}

TASK: ${action.title}

QUESTION: ${clarification.question}

EXISTING OWNER: ${action.owner_email || "Unknown"}
EXISTING DEADLINE: ${action.due_at || "Unknown"}

HUMAN ANSWER:
${answer}
`,
      "clarification_resolution",
      clarificationSchema,
    );

    const owner = normalizeEmail(parsed.owner_email) ||
      normalizeEmail(action.owner_email);

    const deadline = isValidDate(parsed.due_at)
      ? parsed.due_at
      : action.due_at;

    const priority = parsed.priority || action.priority;

    if (!owner || !isValidDate(deadline)) {
      return json({
        success: false,
        error: "The answer does not provide a valid owner and deadline.",
        needs_more_information: true,
        extracted: parsed,
      }, 422);
    }

    const { data: updated, error: updateError } = await supabase
      .from("action_items")
      .update({
        owner_email: owner,
        due_at: deadline,
        priority,
        status: "open",
      })
      .eq("id", action.id)
      .eq("status", "needs_clarification")
      .select()
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    const { error: resolveError } = await supabase
      .from("clarifications")
      .update({
        resolved: true,
        answer: answer.trim(),
      })
      .eq("id", clarification_id);

    if (resolveError) {
      throw new Error(resolveError.message);
    }

    return json({
      success: true,
      message: "Clarification resolved",
      action_item: updated,
    });
  } catch (error) {
    console.error("Resolve clarification error:", error);

    return json({
      success: false,
      error: errorMessage(error),
    }, 500);
  }
});
