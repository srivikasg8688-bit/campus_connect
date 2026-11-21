
import { createClient } from "jsr:@supabase/supabase-js@2";

export const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
export const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

export const supabase = createClient(supabaseUrl, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const MODEL =
  Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";

export const EMBEDDING_MODEL =
  Deno.env.get("OPENAI_EMBEDDING_MODEL") || "text-embedding-3-small";

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-cron-secret",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export async function authenticate(req: Request) {
  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing bearer authentication");
  }

  const token = authorization.slice(7);

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("Invalid or expired authentication token");
  }

  return data.user;
}

export async function openaiRequest(
  endpoint: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `https://api.openai.com/v1/${endpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `OpenAI API error (${response.status}): ${JSON.stringify(result)}`,
    );
  }

  return result;
}

export async function createEmbedding(text: string): Promise<number[]> {
  const result = await openaiRequest("embeddings", {
    model: EMBEDDING_MODEL,
    input: text.slice(0, 30000),
    dimensions: 1536,
  });

  const embedding = result.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || embedding.length !== 1536) {
    throw new Error("Invalid embedding returned by OpenAI");
  }

  return embedding;
}

export async function askLLM<T>(
  systemPrompt: string,
  userPrompt: string,
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<T> {
  const result = await openaiRequest("chat/completions", {
    model: MODEL,
    temperature: 0.1,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        strict: true,
        schema,
      },
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("LLM returned an empty response");
  }

  return JSON.parse(content) as T;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return email;
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isDueWithin24Hours(value: string): boolean {
  const due = new Date(value).getTime();
  const now = Date.now();

  return due <= now + 24 * 60 * 60 * 1000;
}

export function corsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, x-cron-secret",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  return null;
}
