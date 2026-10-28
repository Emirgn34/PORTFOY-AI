import { checked } from './automationDb.js';

const headers = (env) => ({ Authorization: `Bearer ${env.HEDGE_GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' });
export function hedgeRepository(env) {
  const repository = env.HEDGE_GITHUB_REPOSITORY || 'Emirgn34/PORTFOY-AI';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Geçersiz depo ayarı.');
  return repository;
}

export async function requestHedgeJob(sb, userId, { source = 'manual', fetcher = fetch, env = process.env } = {}) {
  if (!env.HEDGE_GITHUB_TOKEN) throw new Error('Analiz başlatma bağlantısı kurulmamış.');
  const repository = hedgeRepository(env);
  const reservation = checked(await sb.rpc('reserve_hedge_radar_refresh', { p_user_id: userId, p_source: source }));
  if (!reservation.dispatch) return reservation;
  let response;
  try {
    response = await fetcher(`https://api.github.com/repos/${repository}/actions/workflows/hedge_radar.yml/dispatches`, {
      method: 'POST', headers: headers(env), body: JSON.stringify({ ref: 'main', inputs: { refresh_version: String(reservation.revision) } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('dispatch');
  } catch {
    // If a worker already registered this request after an ambiguous timeout,
    // the null run-id guard prevents us from failing its active analysis.
    checked(await sb.rpc('fail_hedge_radar_run', { p_user_id: userId, p_revision: reservation.revision, p_run_id: null,
      p_error: 'Analiz iş akışı başlatılamadı. Bağlantıyı kontrol edip yeniden deneyin.' }));
    throw new Error('Analiz başlatılamadı. GitHub Actions bağlantısını kontrol edip yeniden deneyin.');
  }
  const data = response.status === 204 ? {} : await response.json().catch(()=>({}));
  const runId = Number.isSafeInteger(data.workflow_run_id) && data.workflow_run_id > 0 ? data.workflow_run_id : null;
  if (runId) {
    try {
      checked(await sb.from('hedge_radar_state').update({ refresh_run_id: runId,
        refresh_run_url: `https://github.com/${repository}/actions/runs/${runId}` })
        .eq('id',1).eq('owner_user_id',userId).eq('refresh_version',reservation.revision).in('refresh_status',['queued','running']));
    } catch {
      // Accepted work registers itself in the first workflow step as well.
      console.warn('[hedge-job] İş kimliği işçi başladığında yeniden kaydedilecek.');
    }
  }
  return { ...reservation, runId };
}

export async function reconcileHedgeJob(sb, state, { fetcher = fetch, env = process.env, now = Date.now() } = {}) {
  if (!state || !['queued','running'].includes(state.refresh_status)) return state;
  const deadline = Date.parse(state.refresh_deadline_at || '') || Date.parse(state.refresh_started_at || state.refresh_requested_at) + 15 * 60000;
  if (deadline <= now) {
    // Expire stale work without dispatching a job from a read request.
    checked(await sb.rpc('fail_hedge_radar_run', { p_user_id: state.owner_user_id, p_revision: state.refresh_version,
      p_run_id: state.refresh_run_id || null, p_error: 'Analiz zamanında tamamlanmadı. Yeniden başlatabilirsiniz.' }));
  } else if (state.refresh_run_id && env.HEDGE_GITHUB_TOKEN) {
    try {
      const response = await fetcher(`https://api.github.com/repos/${hedgeRepository(env)}/actions/runs/${state.refresh_run_id}`,
        { headers: headers(env), signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const run = await response.json();
        if (run.status === 'completed') {
          const message = run.conclusion === 'success' ? 'İş akışı bitti ancak yeni analiz kaydedilmedi. Yeniden deneyebilirsiniz.'
            : 'Analiz iş akışı tamamlanamadı. Yeniden deneyebilir veya iş ayrıntılarını açabilirsiniz.';
          checked(await sb.rpc('fail_hedge_radar_run', { p_user_id: state.owner_user_id, p_revision: state.refresh_version,
            p_run_id: state.refresh_run_id, p_error: message }));
        } else if (run.status === 'in_progress' && state.refresh_status === 'queued') {
          checked(await sb.rpc('start_hedge_radar_run', { p_user_id: state.owner_user_id, p_revision: state.refresh_version,
            p_run_id: state.refresh_run_id, p_run_url: state.refresh_run_url, p_source: state.refresh_source || 'manual' }));
        }
      }
    } catch { return state; } // A monitoring outage is not an analysis failure.
  }
  return checked(await sb.from('hedge_radar_state').select('*').eq('id',1).eq('owner_user_id',state.owner_user_id).maybeSingle());
}

export async function maybeRefreshHedge(sb, { env = process.env, fetcher = fetch, now = new Date() } = {}) {
  if (!env.HEDGE_RADAR_USER_ID || !env.HEDGE_GITHUB_TOKEN) return { configured: false };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type,p.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (['Sat','Sun'].includes(parts.weekday) || minute < 570 || minute > 965) return { skipped: true };
  // The Python exchange calendar is authoritative for holidays and early closes.
  return requestHedgeJob(sb, env.HEDGE_RADAR_USER_ID, { source: 'scheduled', env, fetcher });
}
