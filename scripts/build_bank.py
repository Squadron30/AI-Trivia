import json, glob, os
base=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
qdir=os.path.join(base,'questions')
# Emphasis: design & architecture, knowledge/reasoning, problem solving.
# Exclude AI-history-style questions from the bank.
EXCLUDE_CATEGORIES={'AI History'}
EXCLUDE_IDS=set()  # history content removed from source; nothing to exclude by ID

allq=[]; ids=set(); errors=[]; skipped=0
for f in sorted(glob.glob(os.path.join(qdir,'*.json'))):
    if f.endswith('question-bank.json'): continue
    data=json.load(open(f))
    for q in data:
        if q.get('category') in EXCLUDE_CATEGORIES or q['id'] in EXCLUDE_IDS:
            skipped+=1; continue
        # validate
        if q['id'] in ids: errors.append('dup id '+q['id'])
        ids.add(q['id'])
        if len(q['options'])!=4: errors.append('not 4 opts '+q['id'])
        if not (0<=q['answer']<=3): errors.append('bad answer '+q['id'])
        if q['difficulty'] not in ('beginner','intermediate','advanced'): errors.append('bad diff '+q['id'])
        allq.append(q)
# difficulty counts
from collections import Counter
diff=Counter(q['difficulty'] for q in allq)
cat=Counter(q['category'] for q in allq)
bank={'meta':{'total':len(allq),'byDifficulty':dict(diff),'byCategory':dict(cat)},'questions':allq}
json.dump(bank, open(os.path.join(qdir,'question-bank.json'),'w'), indent=1)
print('ERRORS:', errors if errors else 'none')
print('EXCLUDED (history):', skipped)
print('TOTAL:', len(allq))
print('DIFFICULTY:', dict(diff))
print('CATEGORIES:', dict(cat))
