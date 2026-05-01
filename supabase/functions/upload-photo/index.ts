// supabase/functions/upload-photo/index.ts
//
// Verifies the caller is a legitimate Supabase Auth user (JWT in Authorization header).
// No plain password needed — Supabase issues the JWT on login and verifies it here.
//
// To add upload users: Supabase Dashboard → Authentication → Users → Invite user
// They receive an email to set their password. That's it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "portfolio-images";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "*";
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── 1. Verify the JWT from the Authorization header ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Missing authorization token", { status: 401, headers: corsHeaders });
  }

  const token = authHeader.replace("Bearer ", "");

  // Use anon key + token to verify the user is real and active
  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);

  if (authError || !user) {
    return new Response("Unauthorized — invalid or expired session", {
      status: 401,
      headers: corsHeaders,
    });
  }

  // ── 2. Parse request body ──
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  const { fileBase64, fileName, title, caption, sizeBytes } = body as {
    fileBase64?: string;
    fileName?: string;
    title?: string;
    caption?: string;
    sizeBytes?: number;
  };

  if (!fileBase64 || !fileName) {
    return new Response("Missing fileBase64 or fileName", { status: 400, headers: corsHeaders });
  }

  // ── 3. Upload with SERVICE_ROLE_KEY (bypasses storage RLS) ──
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SERVICE_ROLE_KEY")!,
  );

  let fileBuffer: Uint8Array;
  try {
    fileBuffer = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
  } catch {
    return new Response("Invalid base64 data", { status: 400, headers: corsHeaders });
  }

  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const contentTypeMap: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", webp: "image/webp", gif: "image/gif",
  };
  const contentType = contentTypeMap[ext] ?? "image/jpeg";

  const { error: storageError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(fileName, fileBuffer, { contentType, upsert: false });

  if (storageError) {
    console.error("Storage error:", storageError);
    return new Response(JSON.stringify(storageError), { status: 500, headers: corsHeaders });
  }

  // ── 4. Get public URL and insert metadata row ──
  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(fileName);

  const { error: dbError } = await supabaseAdmin.from("photos").insert({
    title: title || fileName.split("/").pop(),
    caption: caption || "",
    file_name: fileName.split("/").pop(),
    storage_path: fileName,
    public_url: urlData.publicUrl,
    size_bytes: sizeBytes ?? fileBuffer.byteLength,
    uploaded_by: user.email,   // track who uploaded it
  });

  if (dbError) {
    console.error("DB error:", dbError);
    return new Response(JSON.stringify(dbError), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ publicUrl: urlData.publicUrl }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});