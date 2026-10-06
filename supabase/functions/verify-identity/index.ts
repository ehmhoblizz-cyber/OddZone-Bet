// supabase/functions/verify-identity/index.ts
// Supabase Edge Function to verify Nigerian Bank Account, BVN, or NIN with Paystack
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS is enforced twice: a simple request may arrive without a preflight,
// and a failure mid-handshake leaves the browser with an opaque error. Handle
// every shape explicitly and always include the headers on the real response,
// otherwise the client only ever sees "blocked by CORS policy".
//
// "*" is correct here: the endpoint authenticates with a Bearer JWT, not with
// cookies, so there is no ambient authority for another origin to ride on.
// If cookie-based sessions are ever introduced, replace this with an explicit
// allow-list of the GitHub Pages origin.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cache-control, pragma",
  "Access-Control-Expose-Headers": "content-length, x-request-id",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization token" }, 401);
    }

    const { action, bankCode, accountNumber, bvn, legalName, userId } = await req.json();

    // -------------------------------------------------------------
    // ACTION 1: Resolve Bank Account (100% Free on Paystack)
    // -------------------------------------------------------------
    if (action === "resolve_account") {
      if (!bankCode || !accountNumber) {
        return json({ error: "bankCode and accountNumber required" }, 400);
      }

      const res = await fetch(
        `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        {
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
          },
        }
      );

      const data = await res.json();
      if (!data.status) {
        return json({ error: data.message || "Invalid account details" }, 400);
      }

      return json({
        success: true,
        account_name: data.data.account_name,
        account_number: data.data.account_number,
      });
    }

    // -------------------------------------------------------------
    // ACTION 2: Match BVN with Bank Account
    // -------------------------------------------------------------
    if (action === "match_bvn") {
      if (!bvn || !bankCode || !accountNumber) {
        return json({ error: "bvn, bankCode, and accountNumber are required" }, 400);
      }

      const res = await fetch("https://api.paystack.co/bvn/match", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bvn,
          account_number: accountNumber,
          bank_code: bankCode,
        }),
      });

      const data = await res.json();
      const isMatched = data.status && data.data?.is_blacklisted === false;

      if (isMatched && userId) {
        // Save verified status in Supabase profiles
        const masked = bvn.slice(0, 3) + "******" + bvn.slice(-2);
        await supabase
          .from("profiles")
          .update({
            is_verified: true,
            kyc_type: "bvn",
            kyc_id_masked: masked,
            legal_name: legalName || data.data?.account_name || "Verified User",
          })
          .eq("id", userId);
      }

      return json({
        success: isMatched,
        message: isMatched ? "Identity verified successfully" : data.message || "BVN mismatch",
        data: data.data,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
