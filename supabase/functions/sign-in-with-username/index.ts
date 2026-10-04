import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function invalidCredentials() {
  return respond({ error: "Invalid username or password." }, 401);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  let credentials: unknown;
  try {
    credentials = await request.json();
  } catch {
    return respond({ error: "A username and password are required." }, 400);
  }

  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    return respond({ error: "A username and password are required." }, 400);
  }

  const payload = credentials as { username?: unknown; password?: unknown };
  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!username || !password || username.length > 320) {
    return invalidCredentials();
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    console.error("Username sign-in is missing its Supabase Edge Function environment.");
    return respond({ error: "Username sign-in is not configured. Contact the site administrator." }, 500);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const candidates: string[] = [];

  if (username.includes("@")) {
    candidates.push(username);
  } else {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const normalizedUsername = username.toLocaleLowerCase("en-US");
    const pageSize = 1000;
    for (let page = 1; ; page += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: pageSize });
      if (error) {
        console.error("Supabase could not look up a username for sign-in.", error);
        return respond({ error: "Could not sign in right now. Try again shortly." }, 503);
      }

      data.users.forEach(user => {
        const savedUsername = user.user_metadata?.username;
        if (typeof savedUsername === "string" && savedUsername.trim().toLocaleLowerCase("en-US") === normalizedUsername) {
          if (user.email) candidates.push(user.email);
        }
      });
      if (data.users.length < pageSize) break;
    }
  }

  if (!candidates.length) return invalidCredentials();

  for (const email of candidates) {
    const { data, error } = await userClient.auth.signInWithPassword({ email, password });
    if (!error && data.session) {
      return respond({ session: data.session }, 200);
    }
    if (error && /rate limit|too many requests/i.test(error.message)) {
      return respond({ error: "Too many sign-in attempts. Wait a moment and try again." }, 429);
    }
  }

  return invalidCredentials();
});
