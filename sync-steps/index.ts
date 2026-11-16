// Supabase Edge Function: sync-steps
// Recibe { token, pasos } desde Atajos de iPhone (o una app nativa) y guarda
// los pasos en step_logs. "pasos" es el TOTAL de hoy; la función calcula la
// diferencia con lo ya guardado, así que se puede llamar varias veces al día
// sin duplicar y el gráfico "Cuándo caminan" queda con horas reales.
//
// Deploy:  supabase functions deploy sync-steps --no-verify-jwt
// (--no-verify-jwt es necesario: Atajos no tiene sesión de Supabase.
//  La seguridad la da la clave personal de cada usuario.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TZ = "America/Argentina/Buenos_Aires";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Content-Type": "application/json",
};
const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out({ error: "Usá POST" }, 405);

  try {
    const b = await req.json();
    const token = String(b.token ?? "").trim();
    const total = Math.round(Number(b.pasos));

    if (!/^[0-9a-f-]{36}$/i.test(token)) return out({ error: "Clave inválida" }, 400);
    if (!Number.isFinite(total) || total < 0 || total > 100000) {
      return out({ error: "Cantidad de pasos inválida" }, 400);
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: t } = await db
      .from("sync_tokens").select("user_id").eq("token", token).maybeSingle();
    if (!t) return out({ error: "Clave no reconocida" }, 401);

    const now = new Date();
    const dia = now.toLocaleDateString("en-CA", { timeZone: TZ });
    const hora = parseInt(
      now.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }),
      10,
    ) % 24;

    const { data: logs, error: e1 } = await db
      .from("step_logs").select("hora,pasos").eq("user_id", t.user_id).eq("dia", dia);
    if (e1) throw e1;

    const ya = (logs ?? []).reduce((a, l) => a + l.pasos, 0);
    const delta = total - ya;

    if (delta > 0) {
      const actual = (logs ?? []).find((l) => l.hora === hora);
      const { error: e2 } = await db.from("step_logs").upsert(
        { user_id: t.user_id, dia, hora, pasos: (actual?.pasos ?? 0) + delta },
        { onConflict: "user_id,dia,hora" },
      );
      if (e2) throw e2;
    }

    return out({ ok: true, dia, total_hoy: Math.max(total, ya) });
  } catch (err) {
    return out({ error: String((err as Error).message ?? err) }, 500);
  }
});
