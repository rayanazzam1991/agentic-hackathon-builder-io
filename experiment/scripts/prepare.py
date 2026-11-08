#!/usr/bin/env python3
"""Prepare isolated model inputs; never calls a provider or includes reviewer keys."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from validate import ROOT, read_package, validate_package


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(case, destination, prior=None):
    source = ROOT / 'fixtures' / f'{case}.json'
    package = read_package(source)
    if isinstance(package['prior_brief'], str):
        if prior is None:
            raise ValueError(f'{case} needs an actual prior generated brief via --prior-brief')
        from validate import validate_output
        previous = 'C' if case == 'D-initial' else 'D-initial'
        prior_package = read_package(ROOT / 'fixtures' / f'{previous}.json')
        validate_output(prior, prior_package)
        package['prior_brief'] = prior
    elif prior is not None:
        raise ValueError('prior brief not expected for this case')
    validate_package(package)
    destination = destination.resolve()
    if destination.exists():
        raise ValueError('destination already exists; preserve previous preparations/runs')
    destination.mkdir(parents=True)
    input_path = destination / 'input.json'
    input_path.write_text(json.dumps(package, indent=2, ensure_ascii=False) + '\n')
    import shutil
    for name in ['prompt-v1.md', 'brief.schema.json']:
        shutil.copyfile(ROOT / 'contracts' / name, destination / name)
    images = []
    for item in package['sources']:
        if item['kind'] == 'design_image':
            source_image = ROOT / 'fixtures' / item['image_path']
            image_path = destination / item['image_path']
            image_path.parent.mkdir(exist_ok=True)
            shutil.copyfile(source_image, image_path)
            images.append({'source_id': item['id'], 'path': item['image_path'], 'sha256': digest(image_path)})
    manifest = {
        'case_id': case, 'prepared_at': datetime.now(timezone.utc).isoformat(),
        'state': 'prepared_not_generated', 'contract_version': '1.0',
        'prompt_sha256': digest(destination / 'prompt-v1.md'),
        'schema_sha256': digest(destination / 'brief.schema.json'),
        'input_sha256': digest(input_path), 'images': images,
        'provider': None, 'model': None, 'generation_settings': None,
        'latency_seconds': None, 'usage': None, 'cost': None,
        'limitation': 'No model call or factual review has occurred. Reviewer keys are excluded.'
    }
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    mapping = '\n'.join(f'Image {i+1}: source_id={x["source_id"]}; file={x["path"]}' for i,x in enumerate(images))
    prompt = (destination / 'prompt-v1.md').read_text()
    schema = (destination / 'brief.schema.json').read_text()
    (destination / 'request.txt').write_text(f'{prompt}\nOutput schema:\n{schema}\n\nAttachment order:\n{mapping or "No images supplied."}\n\nEvidence package:\n{input_path.read_text()}')
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', required=True, choices=['A','B','C','D-initial','D-reply','R-refactor','R-injection'])
    parser.add_argument('--destination', required=True, type=Path)
    parser.add_argument('--prior-brief', type=Path)
    args = parser.parse_args()
    prior = json.loads(args.prior_brief.read_text()) if args.prior_brief else None
    print(prepare(args.case, args.destination, prior))

if __name__ == '__main__':
    main()
