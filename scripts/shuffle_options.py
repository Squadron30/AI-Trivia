# Rebalance the correct-answer position across A/B/C/D so it's evenly distributed
# and not guessable. Idempotent: always produces a near-uniform spread regardless
# of the current state of the files.
import json, glob, os, random, math
random.seed(20260722)

qdir='questions'
files=[f for f in sorted(glob.glob(os.path.join(qdir,'*.json'))) if not f.endswith('question-bank.json')]
loaded=[(f, json.load(open(f))) for f in files]

# flatten references in a fixed order, then randomize which get A/B/C/D targets
flat=[q for _,data in loaded for q in data]
n=len(flat)
targets=([0,1,2,3]*math.ceil(n/4))[:n]
random.shuffle(targets)

for q,tgt in zip(flat,targets):
    opts=q['options']; correct=opts[q['answer']]
    distract=[o for i,o in enumerate(opts) if i!=q['answer']]
    random.shuffle(distract)
    newopts=[None]*4
    newopts[tgt]=correct
    di=0
    for i in range(4):
        if newopts[i] is None:
            newopts[i]=distract[di]; di+=1
    q['options']=newopts
    q['answer']=tgt

for f,data in loaded:
    json.dump(data, open(f,'w'), indent=1, ensure_ascii=False)

from collections import Counter
print('rebalanced', n, 'questions across', len(files), 'files')
print('target distribution:', dict(sorted(Counter(targets).items())))
