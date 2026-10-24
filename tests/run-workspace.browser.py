"""Real Discovery journeys with this checkout's renderer and the maintained QA browser.

Run with the installed tangle-ops QA venv Python after the library build. The
finite loopback proxy preserves real host HTML/data and replaces only the two
renderer assets. It forwards GET only, without cookies or authorization.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen

def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--run', action='append', required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--asset-root', type=Path, help='compiled renderer artifact directory; defaults to this checkout’s dist')
    parser.add_argument('--renderer-sha256', required=True)
    parser.add_argument('--stylesheet-sha256', required=True)
    parser.add_argument('--serve-seconds', type=int, default=0,
                        help='finite manual preview; uses no browser runtime or automated tests')
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if origin.scheme != 'https' or not origin.netloc or origin.username or origin.password or origin.path not in ('', '/') or origin.query or origin.fragment:
        parser.error('--origin must be an HTTPS origin without credentials, path or query')
    if not args.run or any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', run) for run in args.run):
        parser.error('--run requires existing run identities')
    if any(not re.fullmatch(r'[a-f0-9]{64}', value) for value in (args.renderer_sha256, args.stylesheet_sha256)):
        parser.error('renderer and stylesheet hashes must come from the exact build receipt')
    if not 0 <= args.serve_seconds <= 3600:
        parser.error('--serve-seconds must be a bounded preview lifetime')
    args.origin = args.origin.rstrip('/')
    return args


def preview_server(origin, asset_root, traffic):
    assets = {
        '/assets/agent-record/workspace-viewer.js': (asset_root / 'workspace-viewer.js', 'text/javascript'),
        '/assets/agent-record/styles.css': (asset_root / 'styles.css', 'text/css'),
    }

    class Preview(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reject_write(self):
            traffic.append({'method': self.command, 'path': urlsplit(self.path).path})
            self.send_error(405)

        do_POST = do_PUT = do_PATCH = do_DELETE = reject_write

        def do_GET(self):
            allowed_origin = f'http://127.0.0.1:{self.server.server_port}'
            if self.headers.get('Origin') not in (None, allowed_origin) or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                return self.send_error(403)
            target = urlsplit(self.path)
            if target.scheme or target.netloc or not self.path.startswith('/'):
                return self.send_error(400)
            path = target.path
            traffic.append({'method': 'GET', 'path': path})
            try:
                if path in assets:
                    file, kind = assets[path]
                    body = file.read_bytes()
                    self.send_response(200)
                    self.send_header('Content-Type', kind)
                    self.send_header('Cache-Control', 'no-store')
                else:
                    request = Request(origin + self.path, headers={'Accept': self.headers.get('Accept', '*/*')})
                    try:
                        response = urlopen(request, timeout=30)
                    except HTTPError as error:
                        response = error
                    with response:
                        body = response.read(32 * 1024 * 1024 + 1)
                        if len(body) > 32 * 1024 * 1024:
                            raise ValueError('preview response exceeds the bounded read limit')
                        self.send_response(response.status)
                        for key, value in response.headers.items():
                            if key.lower() not in ('content-length', 'transfer-encoding', 'connection', 'content-encoding'):
                                self.send_header(key, value)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (OSError, ValueError) as error:
                self.send_error(502, type(error).__name__)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Preview)
    server.daemon_threads = True
    Thread(target=server.serve_forever, daemon=True).start()
    return server


def history_journey(page, base, run_id, manifest, result, evidence):
    versions = manifest['history']['versions']
    if len(versions) < 2:
        result['history'].append({'runId': run_id, 'state': 'unavailable', 'reason': 'No pair of retained commits'})
        return
    oldest, newest = versions[-1]['commit'], versions[0]['commit']
    documents = [page.request.get(f'{base}/api/discovery/runs/{run_id}/files?version={sha}') for sha in (oldest, newest)]
    assert all(response.ok for response in documents), 'historical inventory request failed'
    old, new = [response.json() for response in documents]
    old_paths = {item['path'] for item in old['items']}
    added = next((item for item in new['items'] if item['path'] not in old_paths and item.get('bytes') != 0), None)
    if not added or old['state'] != 'available' or not old['complete']:
        result['history'].append({'runId': run_id, 'state': 'unavailable', 'reason': 'No complete comparable added-page pair'})
        return
    document = page.request.get(f'{base}/api/discovery/runs/{run_id}').json()
    current_files = (document.get('finalOutput') or {}).get('files') or []
    content_response = page.request.get(base + added['href'])
    assert content_response.ok
    expected_lines = content_response.text().splitlines()
    content_hash = hashlib.sha256(content_response.body()).hexdigest()
    for version, comparison, direction in ((newest, oldest, 'added'), (oldest, newest, 'removed')):
        query = urlencode({'variant': 'review', 'theme': 'light', 'file': added['path'], 'fileVersion': version,
                           'compareVersion': comparison, 'fileView': 'diff'})
        page.goto(f'{base}/run/{run_id}?{query}', wait_until='domcontentloaded')
        page.get_by_test_id('diff-view').wait_for(state='visible', timeout=30000)
        page.get_by_text('Read plain-text diff', exact=True).click()
        patch = page.get_by_role('region', name=f"Plain-text diff for {added['path'].split('/')[-1]}").inner_text()
        assert patch.strip(), 'the shared diff has no accessible text patch'
        prefix = '+' if direction == 'added' else '-'
        delta, in_hunk = [], False
        for line in patch.splitlines():
            if line.startswith('@@'):
                in_hunk = True
            elif in_hunk and line.startswith(prefix):
                delta.append(line[1:])
        assert '\n'.join(delta).rstrip('\n') == '\n'.join(expected_lines).rstrip('\n'), f'{direction} patch differs from the real retained file'
        (evidence / f'{run_id}-{direction}.diff').write_text(patch)
        selection = parse_qs(urlsplit(page.url).query)
        provenance = page.locator('.run-file-proof code').text_content()
        page.reload(wait_until='domcontentloaded')
        page.get_by_test_id('diff-view').wait_for(state='visible', timeout=30000)
        assert parse_qs(urlsplit(page.url).query) == selection
        assert page.locator('.run-file-proof code').text_content() == provenance
        if direction == 'removed':
            assert page.get_by_text(re.compile('Removed from the selected version')).is_visible()
        assert not page.locator('[data-grade]').count()
        page.screenshot(path=str(evidence / f'{run_id}-{direction}-diff.png'))
        result['history'].append({'runId': run_id, 'file': added['path'], 'selected': version,
                                  'comparison': comparison, 'direction': direction, 'contentSha256': content_hash, 'selectionReload': 'proved', 'state': 'proved'})
    if current_files:
        query = urlencode({'section': 'outputs', 'file': current_files[0]['path'], 'fileVersion': oldest, 'compareVersion': newest})
        page.goto(f'{base}/run/{run_id}?{query}', wait_until='domcontentloaded')
        page.get_by_text('File feedback applies to the current primary artifact.', exact=False).wait_for(state='visible', timeout=30000)
        assert not page.locator('[data-grade]').count(), 'historical view exposes a current grade control'
        result['historicalFeedback'].append({'runId': run_id, 'state': 'current grade controls absent in anonymous historical view'})


def run_journeys(args, base, browser, result):
    for theme in ('light', 'dark'):
        for width, height in ((1440, 1000), (390, 844)):
            context = browser.new_context(viewport={'width': width, 'height': height}, color_scheme=theme, is_mobile=width == 390, has_touch=width == 390,
                                          record_video_size={'width': width, 'height': height},
                                          record_video_dir=str(args.evidence / 'videos'))
            try:
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                for run_id in args.run:
                    response = page.request.get(f'{base}/api/discovery/runs/{run_id}/files')
                    assert response.ok, f'file API precondition failed, HTTP {response.status}'
                    manifest = response.json()
                    assert manifest['runId'] == run_id and manifest['items'], 'real run has no retained artifact for this journey'
                    for variant in ('workspace', 'document', 'review'):
                        page.goto(f'{base}/run/{run_id}?variant={variant}&theme={theme}', wait_until='domcontentloaded')
                        page.locator('.run-home h1').wait_for(state='visible', timeout=30000)
                        page.locator('.run-file-content .run-retained-preview').wait_for(state='visible', timeout=30000)
                        assert page.locator('.run-file-header h3').inner_text().strip()
                        assert page.locator('.ar-ws').get_attribute('data-theme') == theme
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'overflow: {variant}/{width}/{theme}'
                        assert not errors, errors
                        if width == 390:
                            controls = page.get_by_role('group', name='File workspace', exact=True)
                            assert controls.is_visible() and page.locator('.run-artifact-reader').is_visible()
                            assert not page.locator('.run-file-tree').is_visible(), 'phone starts with tree instead of artifact'
                            controls.get_by_role('button', name='Browse files', exact=True).click()
                            page.locator('.run-file-tree').wait_for(state='visible')
                            assert not page.locator('.run-artifact-reader').is_visible()
                            controls.get_by_role('button', name='Read file', exact=True).click()
                            page.locator('.run-artifact-reader').wait_for(state='visible')
                            assert not page.locator('.run-file-tree').is_visible()
                            result['mobileBrowsing'].append({'runId': run_id, 'variant': variant, 'theme': theme, 'state': 'file/tree/file navigation proved'})
                        if width == 1440 and variant == 'workspace':
                            source = page.locator('.run-file-modes').get_by_role('button', name='Source', exact=True)
                            if source.count():
                                source.click()
                                page.locator('.run-retained-preview pre').wait_for(state='visible', timeout=30000)
                                assert source.get_attribute('aria-pressed') == 'true'
                                result['sourceViews'].append({'runId': run_id, 'theme': theme, 'file': page.locator('.run-file').get_attribute('data-file')})
                                page.locator('.run-file-modes').get_by_role('button', name='Preview', exact=True).click()
                        page.screenshot(path=str(args.evidence / f'{run_id}-{variant}-{width}-{theme}.png'))
                        result['views'].append({'runId': run_id, 'variant': variant, 'width': width, 'theme': theme})
                    if width == 1440:
                        # The selected file identity, view and version context survive the direct link and reload.
                        page.locator('.run-file-proof > a').click()
                        page.locator('.run-file-content .run-retained-preview').wait_for(state='visible', timeout=30000)
                        selected = page.locator('.run-file').get_attribute('data-file')
                        selection = parse_qs(urlsplit(page.url).query)
                        assert selection.get('fileIdentity'), 'the file link omitted its recorded identity'
                        fingerprint = page.locator('.run-file-proof code')
                        provenance = fingerprint.text_content() if fingerprint.count() else None
                        page.reload(wait_until='domcontentloaded')
                        page.locator('.run-file-content .run-retained-preview').wait_for(state='visible', timeout=30000)
                        assert page.locator('.run-file').get_attribute('data-file') == selected
                        assert page.locator('.ar-ws').get_attribute('data-theme') == theme
                        assert parse_qs(urlsplit(page.url).query) == selection
                        fingerprint = page.locator('.run-file-proof code')
                        assert (fingerprint.text_content() if fingerprint.count() else None) == provenance
                        result['reloads'].append({'runId': run_id, 'file': selected, 'theme': theme})
                        if theme == 'light':
                            history_journey(page, base, run_id, manifest, result, args.evidence)
                    assert not errors, errors
            finally:
                context.close()


def main():
    args = arguments()
    root = Path(__file__).resolve().parents[1]
    asset_root = args.asset_root or root / 'dist'
    args.evidence.mkdir(parents=True, exist_ok=True)
    renderer_hash = hashlib.sha256((asset_root / 'workspace-viewer.js').read_bytes()).hexdigest()
    stylesheet_hash = hashlib.sha256((asset_root / 'styles.css').read_bytes()).hexdigest()
    assert renderer_hash == args.renderer_sha256 and stylesheet_hash == args.stylesheet_sha256, 'built assets do not match the qualified build receipt'
    traffic = []
    result = {'schema': 'agent-record.run-workspace-proof.v1', 'views': [], 'sourceViews': [], 'reloads': [], 'history': [], 'historicalFeedback': [], 'mobileBrowsing': [],
              'rendererSha256': renderer_hash, 'stylesheetSha256': stylesheet_hash,
              'source': 'real same-origin Discovery HTML and APIs with only this built renderer replaced',
              'craftVerdict': 'UNCHECKED', 'targetUserVerdict': 'UNCHECKED'}
    server = preview_server(args.origin, asset_root, traffic)
    if args.serve_seconds:
        try:
            print(json.dumps({'previewUrl': f'http://127.0.0.1:{server.server_port}/run/{args.run[0]}?variant=workspace',
                              'rendererSha256': renderer_hash, 'stylesheetSha256': stylesheet_hash}), flush=True)
            Event().wait(args.serve_seconds)
        finally:
            server.shutdown()
            server.server_close()
        return
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                run_journeys(args, f'http://127.0.0.1:{server.server_port}', browser, result)
            finally:
                browser.close()
        assert all(row['method'] == 'GET' for row in traffic), 'preview attempted a write'
        result['verdict'] = 'PASS'
    except Exception as error:
        result.update(verdict='FAIL', error=str(error))
        raise
    finally:
        server.shutdown()
        server.server_close()
        result['traffic'] = traffic
        (args.evidence / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({key: value for key, value in result.items() if key != 'traffic'}))


if __name__ == '__main__':
    main()
