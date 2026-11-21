
import { askLLM } from "./common.ts";
import type { MeetingContext } from "./context.ts";

export interface Decision {
  summary: string;
  ai_reasoning: string;
}

export interface ExtractedAction {
  title: string;
  owner_email: string | null;
  due_at: string | null;
  priority: "low" | "medium" | "high";
  depends_on_title: string | null;
  confidence: number;
  ai_reasoning: string;
  clarification_question: string | null;
}

export interface TaskUpdate {
  existing_action_item_id: string;
  update_type: "completed" | "in_progress" | "reopened" | "cancelled";
  evidence_quote: string;
  ai_reasoning: string;
}

export interface MeetingAnalysis {
  decisions: Decision[];
  action_items: ExtractedAction[];
  task_updates: TaskUpdate[];
}

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "string" },
          ai_reasoning: { type: "string" },
        },
        required: ["summary", "ai_reasoning"],
      },
    },
    action_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          owner_email: {
            type: ["string", "null"],
          },
          due_at: {
            type: ["string", "null"],
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          depends_on_title: {
            type: ["string", "null"],
          },
          confidence: {
            type: "number",
          },
          ai_reasoning: {
            type: "string",
          },
          clarification_question: {
            type: ["string", "null"],
          },
        },
        required: [
          "title",
          "owner_email",
          "due_at",
          "priority",
          "depends_on_title",
          "confidence",
          "ai_reasoning",
          "clarification_question",
        ],
      },
    },
    task_updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          existing_action_item_id: { type: "string" },
          update_type: {
            type: "string",
            enum: [
              "completed",
              "in_progress",
              "reopened",
              "cancelled",
            ],
          },
          evidence_quote: { type: "string" },
          ai_reasoning: { type: "string" },
        },
        required: [
          "existing_action_item_id",
          "update_type",
          "evidence_quote",
          "ai_reasoning",
        ],
      },
    },
  },
  required: ["decisions", "action_items", "task_updates"],
};

export async function extractMeetingActions(
  transcript: string,
  meetingDate: string,
  context: MeetingContext,
): Promise<MeetingAnalysis> {
  const systemPrompt = `
You are a senior meeting intelligence and action extraction engine.

Your job is to analyze meeting transcripts and produce reliable decisions,
action items, and updates to existing commitments.

STRICT RULES:

1. Only extract firm commitments and actual decisions.

2. Do not treat casual suggestions, jokes, hypothetical statements,
   brainstorming, or possibilities as commitments.

3. A firm commitment requires clear evidence that someone agreed
   to perform a specific task or that the group explicitly decided something.

4. Never invent an email address, owner, deadline, or commitment.

5. owner_email must be null if no verified email address is available
   in the transcript or context.

6. Resolve relative deadlines using the meeting date and timezone
   supplied in the user prompt. Return ISO-8601 timestamps.
   If the deadline is vague or cannot be reliably resolved, return null.

7. Do not invent a time of day. For a calendar date without a time,
   use 17:00 in the meeting's supplied timezone, unless that timezone
   is unknown. In that case return null.

8. Confidence must be between 0 and 1.

9. Every decision and action item must contain an exact supporting
   transcript quotation in ai_reasoning.

10. Only update existing tasks when the transcript clearly refers
    to the same commitment.

11. Use the provided existing_action_item_id exactly.
    Never invent an ID.

12. Do not mark a task completed just because someone says it is
    nearly complete or plans to finish it.

13. Do not create duplicate action items when an existing commitment
    already represents the same task.

14. Return only JSON conforming to the provided schema.
`;

  const userPrompt = `
MEETING DATE:
${meetingDate}

CURRENT TRANSCRIPT:
${transcript}

PREVIOUS SIMILAR MEETINGS:
${JSON.stringify(context.similarMeetings)}

EXISTING OPEN COMMITMENTS:
${JSON.stringify(context.activeTasks)}

Extract decisions, new action items, and updates to existing tasks.

Pay particular attention to task ownership, deadlines, dependencies,
and commitments that continue from earlier meetings.
`;

  const result = await askLLM<MeetingAnalysis>(
    systemPrompt,
    userPrompt,
    "meeting_analysis",
    schema,
  );

  // Validate confidence and clean the result.
  result.action_items = result.action_items.map((item) => ({
    ...item,
    confidence: Math.max(0, Math.min(1, item.confidence)),
    owner_email: item.owner_email?.trim() || null,
    due_at: item.due_at?.trim() || null,
  }));

  return result;
}
