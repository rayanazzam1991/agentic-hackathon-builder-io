#!/usr/bin/env python3
"""Offline fixture/output checks. Structural validity is not a factual-accuracy verdict."""
import argparse
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'fixtures'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def schema_check(value, schema, at='$'):
    """Validate the subset used by our checked-in schema; reject unknown keywords."""
    supported = {'$schema', 'title', 'type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'enum'}
    require(set(schema) <= supported, f'{at}: unsupported schema keyword')
    kind = schema.get('type')
    predicates = {'object': lambda x: isinstance(x, dict), 'array': lambda x: isinstance(x, list),
                  'string': lambda x: isinstance(x, str), 'integer': lambda x: type(x) is int,
                  'boolean': lambda x: type(x) is bool}
    require(kind in predicates and predicates[kind](value), f'{at}: expected {kind}')
    if 'enum' in schema:
        require(value in schema['enum'], f'{at}: invalid enum value')
    if kind == 'object':
        require(set(schema.get('required', [])) <= set(value), f'{at}: missing required fields')
        props = schema.get('properties', {})
        if schema.get('additionalProperties') is False:
            require(set(value) <= set(props), f'{at}: unexpected fields')
        for key, child in value.items():
            if key in props:
                schema_check(child, props[key], f'{at}.{key}')
    if kind == 'array':
        require(len(value) >= schema.get('minItems', 0), f'{at}: too few items')
        for index, child in enumerate(value):
            schema_check(child, schema['items'], f'{at}[{index}]')


def read_package(path):
    package = json.loads(Path(path).read_text())
    validate_package(package)
    return package


def validate_package(p):
    from datetime import datetime
    require(p.get('schema_version') == '1.0' and p.get('example_data') is True, 'fixture must be v1 example data')
    for key in ['case_id', 'project', 'feature', 'story', 'story_scope']:
        require(isinstance(p.get(key), str) and p[key].strip(), f'missing {key}')
    require(type(p.get('evidence_version')) is int and p['evidence_version'] > 0, 'invalid evidence version')
    dates = []
    for name in ['handover', 'return']:
        checkpoint = p['checkpoints'][name]
        require(bool(checkpoint['id']), 'missing checkpoint id')
        date = datetime.fromisoformat(checkpoint['at'])
        require(date.tzinfo is not None, 'timezone required')
        dates.append(date)
    require(dates[0] < dates[1], 'checkpoints out of order')
    require(isinstance(p['sources'], list) and 0 < len(p['sources']) <= 10, 'source count out of bounds')
    ids, image_count = set(), 0
    for source in p['sources']:
        require(isinstance(source.get('id'), str) and source['id'] not in ids, 'duplicate/invalid source ID')
        ids.add(source['id'])
        require(bool(source.get('version')), 'source version required')
        require(datetime.fromisoformat(source['captured_at']).tzinfo is not None, 'source timezone required')
        kind = source.get('kind')
        require(kind in {'handover_note', 'jira_snapshot', 'channel_export', 'design_image', 'recorded_reply', 'code_excerpt'}, 'unknown source kind')
        if kind == 'design_image':
            image_count += 1
            path = (FIXTURES / source['image_path']).resolve()
            require(path.is_relative_to(FIXTURES.resolve()), 'image path escapes fixtures')
            data = path.read_bytes()
            require(data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR', 'expected PNG')
            width, height = struct.unpack('>II', data[16:24])
            require(0 < width <= 1600 and 0 < height <= 1200, 'image dimensions exceed limits')
            require(bool(source['regions']), 'image regions required')
            for bounds in source['regions'].values():
                require(len(bounds) == 4 and all(type(x) is int for x in bounds), 'invalid region')
                x1, y1, x2, y2 = bounds
                require(0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height, 'region outside image')
        else:
            require(isinstance(source.get('lines'), list) and source['lines'] and all(isinstance(x, str) for x in source['lines']), 'source needs text lines')
    require(image_count <= 2, 'too many images')
    # Budget includes metadata, saved review records, and runtime prior brief text.
    require(len(json.dumps(p, ensure_ascii=False)) <= 20000, 'text budget exceeded')
    require(isinstance(p['missing_sources'], list) and all(isinstance(x, str) for x in p['missing_sources']), 'invalid missing sources')
    reviews = p['saved_reviews']
    require(len({r['id'] for r in reviews}) == len(reviews), 'duplicate review IDs')
    for review in reviews:
        require(review['review_state'] == 'corrected' and bool(review['corrected_text']), 'invalid saved correction')
    if 'follow_up' in p:
        require(p['follow_up']['delivery_state'] == 'not_sent', 'fixture cannot claim real delivery')
        require(p['follow_up']['recipient'] == 'Leo', 'unexpected example recipient')
        require(p['follow_up']['reply_state'] in {'unanswered', 'answered'}, 'invalid reply state')


def validate_output(brief, package):
    schema_check(brief, json.loads((ROOT / 'contracts/brief.schema.json').read_text()))
    for key in ['case_id', 'story', 'evidence_version']:
        require(brief[key] == package[key], f'{key} does not match input')
    for name in ['handover', 'return']:
        require(brief['checkpoint_ids'][name] == package['checkpoints'][name]['id'], 'checkpoint mismatch')
    sources = {s['id']: s for s in package['sources']}
    require(len(brief['coverage']['included_source_ids']) == len(sources) and set(brief['coverage']['included_source_ids']) == set(sources), 'source coverage mismatch')
    require(len({c['id'] for c in brief['claims']}) == len(brief['claims']), 'duplicate claim IDs')
    for claim in brief['claims']:
        if claim['epistemic_label'] == 'supported':
            require(bool(claim['references']), 'supported claim has no references')
    def walk(value):
        if isinstance(value, dict):
            if set(value) == {'source_id', 'locator'}:
                sid, locator = value['source_id'], value['locator']
                require(sid in sources, f'unknown source {sid}')
                source = sources[sid]
                if source['kind'] == 'design_image':
                    require(locator in source['regions'], f'unknown image region {locator}')
                else:
                    match = re.fullmatch(r'L(\d+)(?:-L(\d+))?', locator)
                    require(match is not None, 'invalid line locator')
                    start, end = int(match[1]), int(match[2] or match[1])
                    require(1 <= start <= end <= len(source['lines']), 'line range out of bounds')
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(brief)
    actual_messages = {match[1] for s in sources.values() if s['kind'] == 'channel_export' for line in s['lines'] if (match := re.search(r'\bmessage=([^;]+);', line))}
    relevant, excluded = set(brief['relevant_message_ids']), set(brief['excluded_message_ids'])
    require(not relevant & excluded, 'message both included and excluded')
    require(relevant | excluded <= actual_messages, 'unknown channel message ID')
    require(set(brief['preserved_review_ids']) == {r['id'] for r in package['saved_reviews']}, 'review IDs not preserved')
    for follow in brief['follow_ups']:
        require(all(sid in sources and sources[sid]['kind'] == 'recorded_reply' for sid in follow['reply_source_ids']), 'invalid reply source')
        if follow['reply_state'] == 'answered':
            require(bool(follow['reply_source_ids']), 'answered without recorded reply')
        else:
            require(not follow['reply_source_ids'], 'unanswered question has reply')
        if 'follow_up' in package:
            expected = package['follow_up']
            require(all(follow[k] == expected[k] for k in ['question_id', 'recipient', 'delivery_state', 'reply_state']), 'follow-up state mismatch')
    if 'follow_up' in package:
        require(len(brief['follow_ups']) == 1, 'expected one tracked follow-up')
    require(bool(brief['proposed_checks'] or brief['open_questions']), 'no useful next check/question')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--package', type=Path)
    args = parser.parse_args()
    if args.output:
        require(args.package is not None, '--package required with --output')
        validate_output(json.loads(args.output.read_text()), read_package(args.package))
        print('Output structure and references valid; human factual review still required.')
    else:
        packages = sorted(FIXTURES.glob('*.json'))
        require(bool(packages), 'no packages')
        for path in packages:
            package = read_package(path)
            print(f'{path.name}: valid; {len(package["sources"])} sources')
        print(f'{len(packages)} packages valid. No model generation or factual review implied.')

if __name__ == '__main__':
    main()
