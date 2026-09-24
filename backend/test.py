#!/usr/bin/env python3
"""Batch-test AudD recognition against a folder of audio clips.
Usage: python audd_batch_test.py /path/to/clips_folder YOUR_API_TOKEN
Outputs results.csv with: filename, status, artist, title, confidence_notes
"""
import sys, os, csv, requests, time

AUDD_URL = 'https://api.audd.io/'
EXTS = {'.mp3', '.wav', '.m4a', '.ogg', '.flac'}

def recognize(path, token):
    with open(path, 'rb') as f:
        r = requests.post(AUDD_URL, data={
            'api_token': token,
            'return': 'apple_music,spotify',
        }, files={'file': f})
    return r.json()

def main():
    if len(sys.argv) != 3:
        print('Usage: python audd_batch_test.py <folder> <api_token>')
        sys.exit(1)

    folder, token = sys.argv[1], sys.argv[2]
    files = sorted(f for f in os.listdir(folder) if os.path.splitext(f)[1].lower() in EXTS)

    if not files:
        print(f'No audio files found in {folder}')
        sys.exit(1)

    print(f'Found {len(files)} files. Testing...')
    rows = []

    for i, fname in enumerate(files, 1):
        path = os.path.join(folder, fname)
        try:
            data = recognize(path, token)
        except Exception as e:
            rows.append([fname, 'request_error', '', '', str(e)])
            print(f'[{i}/{len(files)}] {fname}: request error - {e}')
            continue

        if data.get('status') != 'success':
            rows.append([fname, 'api_error', '', '', data.get('error', {}).get('error_message', '')])
            print(f'[{i}/{len(files)}] {fname}: API error')
        elif data.get('result') is None:
            rows.append([fname, 'no_match', '', '', ''])
            print(f'[{i}/{len(files)}] {fname}: no match')
        else:
            res = data['result']
            rows.append([fname, 'matched', res.get('artist', ''), res.get('title', ''), ''])
            print(f'[{i}/{len(files)}] {fname}: {res.get("artist")} - {res.get("title")}')

        time.sleep(0.3)  # be polite to the API

    out_path = os.path.join(folder, 'results.csv')
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['filename', 'status', 'artist', 'title', 'notes'])
        w.writerows(rows)

    matched = sum(1 for r in rows if r[1] == 'matched')
    print(f'\nDone: {matched}/{len(files)} matched. Results saved to {out_path}')

if __name__ == '__main__':
    main()