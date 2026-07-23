'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Loads the question bank and selects questions for a session according to a
 * year-long progressive difficulty plan.
 *
 * Plan (configurable): the first 4 sessions cover AI basics/fundamentals; the
 * game then ramps into intermediate and finally advanced technical material.
 */
class QuestionService {
  constructor(bankPath) {
    this.bankPath = bankPath || path.join(__dirname, '..', 'questions', 'question-bank.json');
    this.reload();
  }

  reload() {
    const raw = JSON.parse(fs.readFileSync(this.bankPath, 'utf8'));
    this.questions = raw.questions || raw;
    this.byId = new Map(this.questions.map(q => [q.id, q]));
    this.pools = {
      beginner: this.questions.filter(q => q.difficulty === 'beginner'),
      intermediate: this.questions.filter(q => q.difficulty === 'intermediate'),
      advanced: this.questions.filter(q => q.difficulty === 'advanced'),
    };
  }

  get meta() {
    return {
      total: this.questions.length,
      beginner: this.pools.beginner.length,
      intermediate: this.pools.intermediate.length,
      advanced: this.pools.advanced.length,
      categories: [...new Set(this.questions.map(q => q.category))],
    };
  }

  /**
   * High-level topics the presenter can choose. Each maps to one or more
   * underlying question categories. 'all' means the full mixed bank.
   */
  static get TOPICS() {
    return {
      all: { label: 'Mixed — all topics', categories: null },
      fundamentals: { label: 'AI Fundamentals', categories: ['AI Basics', 'AI Fundamentals', 'Intelligent Agents'] },
      assistants: { label: 'AI Assistants & Agents (ChatGPT, Claude, Copilot…)', categories: ['AI Assistants & Agents'] },
      ml: { label: 'Machine Learning', categories: ['Machine Learning'] },
      dl: { label: 'Deep Learning', categories: ['Deep Learning'] },
      nlp: { label: 'Natural Language Processing', categories: ['NLP'] },
      llms: { label: 'Transformers & LLMs', categories: ['Transformers & LLMs'] },
      cv: { label: 'Computer Vision', categories: ['Computer Vision'] },
      rl: { label: 'Reinforcement Learning', categories: ['Reinforcement Learning'] },
      search: { label: 'Problem Solving & Search', categories: ['Problem Solving & Search', 'Adversarial Search', 'Classic AI'] },
      knowledge: { label: 'Knowledge & Reasoning', categories: ['Knowledge Representation & Reasoning', 'Knowledge & Reasoning', 'Logical Agents', 'Planning', 'Uncertainty'] },
      design: { label: 'AI System Design & Architecture', categories: ['AI System Design & Architecture'] },
      ethics: { label: 'AI Ethics & Safety', categories: ['AI Ethics & Safety'] },
      mlops: { label: 'MLOps & Deployment', categories: ['MLOps & Deployment'] },
    };
  }

  /** Topic list for the presenter UI, each with a live question count. */
  topics() {
    const T = QuestionService.TOPICS;
    return Object.entries(T).map(([key, t]) => {
      const count = t.categories === null
        ? this.questions.length
        : this.questions.filter(q => t.categories.includes(q.category)).length;
      return { key, label: t.label, count };
    }).filter(t => t.count > 0);
  }

  /**
   * Difficulty mix for a given (1-based) session number.
   * Sessions 1-4  -> fundamentals (beginner heavy)
   * Sessions 5-10 -> intermediate
   * Sessions 11+  -> advanced
   * Weights are fractions of the 20-question set.
   */
  planForSession(sessionNumber) {
    if (sessionNumber <= 4)  return { beginner: 1.0, intermediate: 0.0, advanced: 0.0 };  // fundamentals only
    if (sessionNumber <= 6)  return { beginner: 0.5, intermediate: 0.5, advanced: 0.0 };  // ease into intermediate
    if (sessionNumber <= 10) return { beginner: 0.15, intermediate: 0.7, advanced: 0.15 };
    if (sessionNumber <= 14) return { beginner: 0.0, intermediate: 0.4, advanced: 0.6 };
    return { beginner: 0.0, intermediate: 0.15, advanced: 0.85 };                          // deep tech
  }

  static shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Pick `count` questions for a session, honouring the difficulty plan,
   * avoiding IDs in `usedIds`, and mixing categories ("different sources").
   * Falls back to reusing questions if a pool is exhausted.
   */
  selectForSession(sessionNumber, count = 20, usedIds = new Set(), topic = 'all') {
    // Topic-focused session: pick from the chosen topic's categories, ordered
    // easy -> hard for a nice flow, ignoring the year-long difficulty ramp.
    const T = QuestionService.TOPICS[topic];
    if (topic && topic !== 'all' && T && T.categories) {
      const inTopic = q => T.categories.includes(q.category);
      let pool = this.questions.filter(q => inTopic(q) && !usedIds.has(q.id));
      if (pool.length < count) pool = this.questions.filter(inTopic); // allow reuse if exhausted
      const rank = { beginner: 0, intermediate: 1, advanced: 2 };
      const chosen = QuestionService.shuffle(pool).slice(0, count)
        .sort((a, b) => rank[a.difficulty] - rank[b.difficulty]);
      return chosen;
    }

    const plan = this.planForSession(sessionNumber);
    const targets = {
      beginner: Math.round(count * plan.beginner),
      intermediate: Math.round(count * plan.intermediate),
      advanced: Math.round(count * plan.advanced),
    };
    // fix rounding so totals == count
    let sum = targets.beginner + targets.intermediate + targets.advanced;
    while (sum < count) { targets.advanced++; sum++; }
    while (sum > count) { targets.advanced = Math.max(0, targets.advanced - 1); sum--; }

    const picked = [];
    const pickedIds = new Set();

    const drawFrom = (level, n) => {
      if (n <= 0) return;
      let pool = this.pools[level].filter(q => !usedIds.has(q.id) && !pickedIds.has(q.id));
      if (pool.length < n) {
        // pool exhausted for the year: allow reuse (but not within this session)
        pool = this.pools[level].filter(q => !pickedIds.has(q.id));
      }
      // spread across categories: group then round-robin
      const byCat = {};
      for (const q of QuestionService.shuffle(pool)) (byCat[q.category] ||= []).push(q);
      const cats = QuestionService.shuffle(Object.keys(byCat));
      let idx = 0;
      while (picked.filter(p => p._level === level).length < n && cats.length) {
        const cat = cats[idx % cats.length];
        const q = byCat[cat] && byCat[cat].shift();
        if (q) { picked.push({ ...q, _level: level }); pickedIds.add(q.id); }
        if (!byCat[cat] || byCat[cat].length === 0) cats.splice(idx % cats.length, 1);
        else idx++;
        if (!cats.length) break;
      }
    };

    drawFrom('beginner', targets.beginner);
    drawFrom('intermediate', targets.intermediate);
    drawFrom('advanced', targets.advanced);

    // top up if any shortfall
    while (picked.length < count) {
      const all = this.questions.filter(q => !pickedIds.has(q.id));
      if (!all.length) break;
      const q = QuestionService.shuffle(all)[0];
      picked.push({ ...q, _level: q.difficulty }); pickedIds.add(q.id);
    }

    return QuestionService.shuffle(picked).slice(0, count).map(q => {
      const { _level, ...rest } = q; return rest;
    });
  }
}

module.exports = QuestionService;
