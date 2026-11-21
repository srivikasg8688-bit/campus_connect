
import { supabase, requireEnv } from "./common.ts";

export async function transcribeMeeting(
  meetingId: string,
  transcript: string | null,
  audioPath: string | null,
): Promise<string> {
  if (transcript?.trim()) {
    return transcript.trim();
  }

  if (!audioPath) {
    throw new Error("Meeting has neither transcript nor audio_path");
  }

  const { data, error } = await supabase.storage
    .from("meeting-audio")
    .download(audioPath);

  if (error || !data) {
    throw new Error(`Audio download failed: ${error?.message}`);
  }

  const extension = audioPath.split(".").pop()?.toLowerCase() || "webm";

  const mimeTypes: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    webm: "audio/webm",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };

  const file = new File(
    [await data.arrayBuffer()],
    `meeting.${extension}`,
    { type: mimeTypes[extension] || "application/octet-stream" },
  );

  const form = new FormData();

  form.append("file", file);
  form.append(
    "model",
    Deno.env.get("OPENAI_TRANSCRIPTION_MODEL") || "whisper-1",
  );

  form.append("response_format", "json");

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
      },
      body: form,
    },
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `Transcription failed: ${JSON.stringify(result)}`,
    );
  }

  const text = result.text?.trim();

  if (!text) {
    throw new Error("Transcription returned empty text");
  }

  return text;
}
