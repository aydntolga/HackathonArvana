"""Supervised HTTP research models. Features are produced by the shared JS extractor."""
from pathlib import Path
import sys,json,hashlib,datetime,os
if os.environ.get('SERVER_DOCTOR_ML_PATH'):sys.path.insert(0,os.environ['SERVER_DOCTOR_ML_PATH'])
import numpy as np
from sklearn.ensemble import RandomForestClassifier,ExtraTreesClassifier
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.metrics import confusion_matrix,roc_auc_score,average_precision_score
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from scipy.sparse import hstack,csr_matrix
import sklearn

ROOT=Path(__file__).resolve().parent/'data'/'http-research'
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def metrics(y,p,threshold):
    pred=p>=threshold;tn,fp,fn,tp=map(int,confusion_matrix(y,pred,labels=[0,1]).ravel())
    div=lambda a,b:a/b if b else None
    return {'matrix':{'tp':tp,'tn':tn,'fp':fp,'fn':fn},'samples':len(y),'accuracy':div(tp+tn,len(y)),
      'precision':div(tp,tp+fp),'recall':div(tp,tp+fn),'falseAlarmRate':div(fp,fp+tn),
      'balancedAccuracy':(div(tp,tp+fn)+div(tn,tn+fp))/2,'rocAuc':float(roc_auc_score(y,p)),'prAuc':float(average_precision_score(y,p)),'threshold':float(threshold)}
def threshold_on_validation(y,p):
    candidates=np.unique(np.r_[np.linspace(.01,1,100),p,1.000001]);choices=[]
    for threshold in candidates:
        pred=p>=threshold;fpr=float(pred[y==0].mean());recall=float(pred[y==1].mean())
        if fpr<=.01:choices.append((recall,-fpr,-threshold,float(threshold)))
    return max(choices)[-1]
def export_forest(model,indices,threshold):
    trees=[]
    for estimator in model.estimators_:
        t=estimator.tree_;values=t.value[:,0,:];prob=values[:,1]/values.sum(axis=1)
        trees.append({'left':t.children_left.tolist(),'right':t.children_right.tolist(),'feature':t.feature.tolist(),'threshold':t.threshold.tolist(),'probability':prob.tolist()})
    return {'kind':'numeric-forest','indices':list(indices),'threshold':threshold,'trees':trees}
def main():
    rows=[json.loads(line) for line in (ROOT/'features.jsonl').read_text().splitlines()]
    prep=json.loads((ROOT/'preparation.json').read_text());manifest=json.loads((ROOT/'source-manifest.json').read_text())
    X=np.array([r['x'] for r in rows],dtype=np.float32);y=np.array([r['label'] for r in rows]);fingerprint=[digest(json.dumps(r['x'])) for r in rows]
    unseen='--unseen-templates' in sys.argv
    output=ROOT/'unseen-lexical' if unseen else ROOT;output.mkdir(parents=True,exist_ok=True)
    groups=np.array([r['group'] for r in rows] if unseen else fingerprint)
    protocol={'version':1,'task':'CSIC normal versus anomalous HTTP request classification, not DDoS attribution',
      'split':('Unseen endpoint-template stress test' if unseen else 'Known-application reference evaluation; endpoint templates may occur in all partitions')+'; five deterministic stratified grouped folds without shuffle; fold 0 test, fold 1 validation, remaining folds train. Identical full feature vectors never cross partitions.',
      'grouping':'endpoint-template' if unseen else 'exact-feature-vector',
      'seed':20261031,'thresholdSelection':'Maximize validation recall subject to validation healthy FPR <= 1%; no test-set tuning',
      'models':{'worker':{'type':'character TF-IDF + LogisticRegression','ngrams':[3,4],'vocabularyLimit':12000,'C':4,'numericFeatures':20},'reviewer':{'type':'independent character TF-IDF + LogisticRegression','ngrams':[2,5],'vocabularyLimit':30000,'C':8,'numericFeatures':30}},
      'limitations':['Historical generated research traffic for one application, not live customer attacks.','Anomalous label also includes unintentional invalid requests.',('New endpoint templates held out.' if unseen else 'Known endpoint and parameter families shared across partitions; correlated request variants may remain. Not unseen-site or unseen-template generalization.'),'Original anomaly-only evaluation protocol replaced by a declared supervised grouped split.','Research data commercial-use permission not established.','Protocol expanded after the unseen-template stress test failed; these development results need independent external validation.']}
    (output/'protocol.json').write_text(json.dumps(protocol,indent=2))
    folds=list(StratifiedGroupKFold(n_splits=5,shuffle=False).split(X,y,groups))
    test=folds[0][1];val=folds[1][1];train=np.setdiff1d(np.arange(len(y)),np.r_[test,val])
    seen={fingerprint[i] for i in train};val_clean=np.array([i for i in val if fingerprint[i] not in seen]);seen.update(fingerprint[i] for i in val_clean)
    test_clean=np.array([i for i in test if fingerprint[i] not in seen]);removed={'validation':len(val)-len(val_clean),'test':len(test)-len(test_clean)};val,test=val_clean,test_clean
    assert not(set(groups[train])&set(groups[val]) or set(groups[train])&set(groups[test]) or set(groups[val])&set(groups[test]))
    split={name:{'rows':len(ix),'normal':int((y[ix]==0).sum()),'anomalous':int((y[ix]==1).sum()),'groups':len(set(groups[ix]))} for name,ix in [('train',train),('validation',val),('test',test)]}
    print(json.dumps({'split':split,'featureCollisionsRemoved':removed}),flush=True)
    if any(s['normal']<100 or s['anomalous']<100 for s in split.values()):raise ValueError('Insufficient class coverage in grouped partitions')
    reports={};models={};parity=[]
    texts=[r['text'] for r in rows]
    for name,ngram,limit,C,indices in [('worker',(3,4),12000,4,range(20)),('reviewer',(2,5),30000,8,range(30))]:
        indices=list(indices);vectorizer=TfidfVectorizer(analyzer='char',ngram_range=ngram,max_features=limit,min_df=2,lowercase=False,sublinear_tf=True)
        xt=vectorizer.fit_transform([texts[i] for i in train]);scaler=StandardScaler(with_mean=False)
        numeric=scaler.fit_transform(X[train][:,indices].astype(np.float64))
        xt=hstack([xt,csr_matrix(numeric)],format='csr')
        model=LogisticRegression(C=C,class_weight='balanced',solver='liblinear',max_iter=500,random_state=71 if name=='worker' else 97)
        model.fit(xt,y[train])
        def transform(ix):return hstack([vectorizer.transform([texts[i] for i in ix]),csr_matrix(scaler.transform(X[ix][:,indices].astype(np.float64)))],format='csr')
        vp=model.predict_proba(transform(val))[:,1];threshold=threshold_on_validation(y[val],vp)
        # Threshold frozen before opening test predictions.
        tp=model.predict_proba(transform(test))[:,1]
        reports[name]={'validation':metrics(y[val],vp,threshold),'test':metrics(y[test],tp,threshold),'defaultThresholdTest':metrics(y[test],tp,.5),
          'vocabularySize':len(vectorizer.vocabulary_)}
        vocabSize=len(vectorizer.vocabulary_)
        models[name]={'kind':'linear-tfidf','indices':indices,'threshold':threshold,'ngram':list(ngram),'vocabulary':{k:int(v) for k,v in vectorizer.vocabulary_.items()},
          'idf':vectorizer.idf_.tolist(),'coef':model.coef_[0,:vocabSize].tolist(),'numericCoef':model.coef_[0,vocabSize:].tolist(),
          'numericScale':scaler.scale_.tolist(),'intercept':float(model.intercept_[0])}
        for j in range(min(50,len(test))):
            if name=='worker':parity.append({'x':X[test[j]].tolist(),'text':texts[test[j]],'worker':float(tp[j])})
            else:parity[j]['reviewer']=float(tp[j])
        print(json.dumps({name:reports[name]['test']}),flush=True)
    now=datetime.datetime.now(datetime.timezone.utc).isoformat();version=digest(json.dumps(models,sort_keys=True))[:16]
    bundle={'schema':1,'task':'http-request-anomaly','features':prep['features'],'version':version,'createdAt':now,**models}
    raw=json.dumps(bundle,separators=(',',':'));(output/'model-pair.json').write_text(raw)
    (output/'parity.json').write_text(json.dumps(parity))
    stress=None
    if (ROOT/'unseen-template-stress-report.json').exists():stress=json.loads((ROOT/'unseen-template-stress-report.json').read_text())
    baseline=json.loads((ROOT/'structural-baseline-report.json').read_text()) if (ROOT/'structural-baseline-report.json').exists() else None
    report={'at':now,'dataset':manifest['dataset'],'datasetDocumentation':manifest['providerDocumentation'],'sourceFiles':manifest['files'],'unseenTemplateStress':stress,'structuralBaseline':baseline,
      'preparation':prep,'protocol':protocol,'split':split,'featureCollisionsRemoved':removed,'models':reports,'modelVersion':version,'modelSha256':digest(raw),'sklearnVersion':sklearn.__version__,
      'comparison':'New request-content task and models; not a direct improvement claim over the earlier synthetic service-health percentages.',
      'deployment':'Observe-only HTTP request classifier; no automatic restrictions; no real DDoS recall measured.'}
    (output/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'version':version,'modelBytes':len(raw),'report':str(output/'report.json')}),flush=True)
if __name__=='__main__':main()
