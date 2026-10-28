"""Workflow lifecycle reporting using only the Python standard library."""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def rpc(name, payload):
    base = os.environ['SUPABASE_URL'].rstrip('/')
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    request = urllib.request.Request(f'{base}/rest/v1/rpc/{name}',
        data=json.dumps(payload).encode(), method='POST',
        headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Analiz durum bildirimi başarısız (HTTP {error.code}).') from None


def start(env=os.environ, call=rpc):
    requested = env.get('HEDGE_REFRESH_VERSION', '').strip()
    revision = int(requested) if requested else None
    run_id = int(env['GITHUB_RUN_ID'])
    repository = env['GITHUB_REPOSITORY']
    result = call('start_hedge_radar_run', {'p_user_id': env['HEDGE_RADAR_USER_ID'], 'p_revision': revision,
        'p_run_id': run_id, 'p_run_url': f'https://github.com/{repository}/actions/runs/{run_id}',
        'p_source': 'scheduled' if env.get('GITHUB_EVENT_NAME') == 'schedule' else 'manual'})
    output = f"active={'true' if result['started'] else 'false'}\nrevision={result.get('revision', '')}\n"
    if env.get('GITHUB_OUTPUT'):
        with Path(env['GITHUB_OUTPUT']).open('a', encoding='utf-8') as target:
            target.write(output)
    return result


def finish(env=os.environ, call=rpc):
    revision = env.get('HEDGE_REFRESH_VERSION', '').strip()
    if not revision:
        return {'skipped': True}
    changed = call('fail_hedge_radar_run', {'p_user_id': env['HEDGE_RADAR_USER_ID'], 'p_revision': int(revision),
        'p_run_id': int(env['GITHUB_RUN_ID']),
        'p_error': 'Analiz iş akışı tamamlandı ancak sonuç kaydedilmedi. Yeniden deneyebilir veya iş ayrıntılarını açabilirsiniz.'})
    return {'unfinished_run_marked_failed': changed}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'finish'])
    args = parser.parse_args()
    try:
        print(json.dumps(start() if args.action == 'start' else finish()))
    except Exception as error:
        print(f'[hedge-job] {type(error).__name__}: durum bildirimi yapılamadı.', file=sys.stderr)
        sys.exit(1)
