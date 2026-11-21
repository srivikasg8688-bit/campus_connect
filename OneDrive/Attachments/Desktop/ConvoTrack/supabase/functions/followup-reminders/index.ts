
import {
  corsPreflight,
  errorMessage,
  json,
  requireEnv,
} from "../_shared/ai-engine/common.ts";

import { runFollowupEngine } from "../_shared/ai-engine/followup.ts";

Deno.serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const suppliedSecret = req.headers.get("x-cron-secret");

    if (
      !suppliedSecret ||
      suppliedSecret !== requireEnv("CRON_SECRET")
    ) {
      return json({ error: "Unauthorized" }, 401);
    }

    const results = await runFollowupEngine();

    return json({
      success: true,
      message: "Follow-up processing completed",
      results,
    });
  } catch (error) {
    console.error("Follow-up engine error:", error);

    return json({
      success: false,
      error: errorMessage(error),
    }, 500);
  }
});
