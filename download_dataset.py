"""Download a complete official capture day; profile without training or loading into RAM."""
import urllib.request, pathlib, hashlib, csv, json, collections, time
root = pathlib.Path(__file__).resolve().parent / 'data'
root.mkdir(exist_ok=True)
name = 'Thursday-15-02-2018_TrafficForML_CICFlowMeter.csv'
url = 'https://cse-cic-ids2018.s3.ca-central-1.amazonaws.com/Processed%20Traffic%20Data%20for%20ML%20Algorithms/' + name
dest = root / name
if not dest.exists():
    tmp = dest.with_suffix('.partial')
    size = 0
    with urllib.request.urlopen(url, timeout=60) as source, tmp.open('wb') as target:
        while chunk := source.read(1024*1024):
            target.write(chunk)
            size += len(chunk)
            if size % (32*1024*1024) == 0: print(f'Downloaded {size//1024//1024} MiB', flush=True)
    if size != 375945899: raise RuntimeError(f'Unexpected file length: {size}; partial retained')
    tmp.replace(dest)
counts = collections.Counter()
invalid = 0
with dest.open(newline='', encoding='utf-8-sig') as source:
    reader = csv.DictReader(source)
    fields = reader.fieldnames
    for row in reader:
        label = row.get('Label')
        if label and label != 'Label': counts[label] += 1
        else: invalid += 1
digest = hashlib.file_digest(dest.open('rb'), 'sha256').hexdigest()
report = {'source':url, 'documentation':'https://www.unb.ca/cic/datasets/ids-2018.html',
          'file':name,'bytes':dest.stat().st_size,'sha256':digest,'labels':dict(counts),
          'invalid_or_repeated_headers':invalid,'columns':fields,
          'status':'downloaded and profiled; NOT trained or evaluated',
          'limitations':'One capture day; no independent test split, no slow-client cohort. Flow features cannot be substituted with HTTP log features.',
          'citation':'Sharafaldin, Lashkari, Ghorbani. Toward Generating a New Intrusion Detection Dataset and Intrusion Traffic Characterization. ICISSP 2018.'}
(root/'manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:report[k] for k in ['bytes','labels','invalid_or_repeated_headers','status']},indent=2),flush=True)
