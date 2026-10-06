// supabase/functions/verify-deposit/index.ts
//
// Confirms a Paystack payment and credits the wallet server-side.
//
// WHY THIS EXISTS
// The browser's Paystack callback used to do `userWalletBalance += amount`
// and be done. That credits money straight from a value the player controls:
// the callback fires as soon as the popup reports success, with no check that
// Paystack actually captured the funds. A player could open DevTools, call the
// callback, and mint an arbitrary balance.
//
// This function is the only thing allowed to credit a wallet. It:
//   1. Reads the caller's user id from the verified JWT — never from the body,
//      so one player cannot credit another's wallet.
//   2. Asks Paystack to verify the reference actually succeeded and that the
//      amount matches what was requested.
//   3. Credits the balance through the record_deposit() SQL function, which is
//      SECURITY DEFINER, so the client can never write wallet_balance itself.
//
// Required secret: PAYSTACK_SECRET_KEY
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cache-control, pragma",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!paystackSecretKey || !serviceKey) {
      return json({ error: "Server is not configured." }, 500);
    }

    // The caller's identity comes from their JWT, not the request body.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization token" }, 401);
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not signed in." }, 401);
    }
    const userId = userData.user.id;

    const { reference, amount } = await req.json();
    if (!reference) {
      return json({ error: "reference is required" }, 400);
    }

    // Ask Paystack what actually happened to this reference.
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${paystackSecretKey}` } },
    );
    const verifyData = await verifyRes.json();

    if (!verifyData?.status || verifyData.data?.status !== "success") {
      return json(
        {
          error: "Payment has not been confirmed by Paystack yet.",
          paystack_status: verifyData?.data?.status ?? verifyData?.message ?? "unknown",
        },
        402,
      );
    }

    const txn = verifyData.data;

    // Only credit what Paystack actually received, in naira.
    const paidNaira = Math.floor(Number(txn.amount) / 100);
    if (!Number.isFinite(paidNaira) || paidNaira <= 0) {
      return json({ error: "Payment amount is invalid." }, 400);
    }

    // Refund protection: if the player asked for a different amount, reject
    // rather than silently crediting the larger of the two.
    if (amount != null && Number(amount) !== paidNaira) {
      return json(
        { error: `Amount mismatch: expected ${amount}, Paystack confirmed ${paidNaira}.` },
        400,
      );
    }

    // A reference can only ever be credited once. record_deposit() is
    // idempotent per call, so guard duplicates here.
    const service = createClient(supabaseUrl, serviceKey);
    const { data: existing } = await service
      .from("transactions")
      .select("id")
      .eq("reference", reference)
      .maybeSingle();

    if (existing) {
      // A retry of an already-credited reference is a success, not an error:
      // the money is in the wallet, which is exactly what the client asked for.
      // Answering 409 here made the app report a failure for a deposit that
      // had in fact gone through.
      return json({
        success: true,
        credited: 0,
        already_credited: true,
        reference,
      });
    }

    // Credit through the SECURITY DEFINER function — the only path that can
    // move a balance now that the profiles UPDATE policy is gone.
    const { data, error: creditErr } = await service.rpc("record_deposit", {
      p_amount: paidNaira,
      p_reference: reference,
    });

    if (creditErr) {
      return json({ error: creditErr.message }, 500);
    }

    // Persist the reference so a replay is caught above. The previous version
    // updated "the newest row for this user" without filtering on the reference,
    // which stamped the reference onto an unrelated transaction (a duel entry,
    // say) and left the deposit row itself unmarked — so the duplicate guard
    // above never matched and a replayed reference could credit twice.
    const { error: stampErr } = await service
      .from("transactions")
      .update({ status: "verified" })
      .eq("reference", reference);

    if (stampErr) {
      console.warn("Could not stamp transaction reference:", stampErr.message);
    }

    return json({ success: true, credited: paidNaira, reference, ...data });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
