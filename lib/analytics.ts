import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase credentials are missing");
}

const supabase = createClient(supabaseUrl, supabaseKey);

export type AnalyticsEvent = {
  event_type: string;
  session_id?: string;
  request_id?: string;
  details?: any;
  timestamp?: string;
};

export async function logAnalytics(event: AnalyticsEvent) {
  const { error } = await supabase.from("analytics").insert([
    {
      event_type: event.event_type,
      session_id: event.session_id || null,
      request_id: event.request_id || null,
      details: event.details || null,
      timestamp: event.timestamp || new Date().toISOString(),
    },
  ]);
  if (error) {
    console.error("Error logging analytics:", error);
  }
}
