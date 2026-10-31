"""Download original CSIC HTTP files; never execute or replay their contents."""
from pathlib import Path
import hashlib,json,urllib.request,datetime

ROOT=Path(__file__).resolve().parent/'data'/'http-research'
FILES=['normalTrafficTraining.txt','normalTrafficTest.txt','anomalousTrafficTest.txt']
BASE='https://raw.githubusercontent.com/msudol/Web-Application-Attack-Datasets/master/OriginalDataSets/csic_2010/'
def main():
    ROOT.mkdir(parents=True,exist_ok=True);entries=[]
    for name in FILES:
        dest=ROOT/name;url=BASE+name
        if not dest.exists():
            with urllib.request.urlopen(url,timeout=60) as response,open(dest.with_suffix('.partial'),'wb') as output:
                while chunk:=response.read(1024*1024):output.write(chunk)
            dest.with_suffix('.partial').replace(dest)
        raw=dest.read_bytes()
        if len(raw)<1000000 or b'HTTP/1.' not in raw:raise ValueError('Invalid dataset response')
        entry={'file':name,'url':url,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};entries.append(entry);print(json.dumps(entry),flush=True)
    manifest={'dataset':'HTTP DATASET CSIC 2010','authors':['Carmen Torrano Gimenez','Alejandro Perez Villegas','Gonzalo Alvarez Maranon'],
      'providerDocumentation':'https://www.impactcybertrust.org/dataset_view?idDataset=940','retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'provenance':'Third-party mirror of original research files; hashes recorded locally, not publisher-signed.',
      'scope':'Generated e-commerce HTTP normal/anomalous requests; includes attacks AND unintentional invalid requests. Not a DDoS or production dataset.',
      'files':entries,'redistribution':'Raw files stay local and are excluded from source control. Commercial-use permission has not been established.'}
    (ROOT/'source-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
if __name__=='__main__':main()
