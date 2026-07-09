# Benchmark Repos

Clone these alongside the handoff repo (e.g. into `~/code/`).
Do **not** clone them inside the handoff directory.

---

## CORE-Bench
**Computational reproducibility of research papers.**
Paper: arXiv:2409.11363 | [GitHub](https://github.com/siegelz/core-bench)

```bash
git clone https://github.com/siegelz/core-bench ~/code/core-bench
```

- ~300 tasks across easy / medium / hard difficulty
- Each task: a Code Ocean capsule (code + data) + a specific question about a paper's numeric result
- The agent must run the code and find the answer

```bash
# Run all tasks
npx tsx src/adapters/core-bench.ts --bench-dir ~/code/core-bench

# Only easy tasks, limit 20
npx tsx src/adapters/core-bench.ts --bench-dir ~/code/core-bench --difficulty easy --limit 20

# One task by id
npx tsx src/adapters/core-bench.ts --bench-dir ~/code/core-bench --task-id <task_id>

# Or use npm script
CORE_BENCH_DIR=~/code/core-bench npm run bench:core
```

---

## ScienceAgentBench
**Data-driven scientific discovery: write Python to answer a research question from a dataset.**
Paper: arXiv:2410.05080 | [GitHub](https://github.com/OSU-NLP-Group/ScienceAgentBench)

```bash
git clone https://github.com/OSU-NLP-Group/ScienceAgentBench ~/code/science-agent-bench
```

- 102 tasks across 4 domains: Bioinformatics, Computational Chemistry, GIS, Psychology
- Each task: a dataset directory + scientific question → write a program that produces the answer
- Evaluation: execution-based (program produces the expected output)

```bash
# Run all tasks
npx tsx src/adapters/science-agent-bench.ts --bench-dir ~/code/science-agent-bench

# Filter by domain
npx tsx src/adapters/science-agent-bench.ts --bench-dir ~/code/science-agent-bench --domain Bioinformatics

# Or use npm script
SCIENCE_AGENT_BENCH_DIR=~/code/science-agent-bench npm run bench:science-agent
```

---

## SciCode
**Scientific research programming: subproblem solving across natural sciences.**
Paper: arXiv:2407.13168 | [GitHub](https://github.com/scicode-bench/scicode)

```bash
git clone https://github.com/scicode-bench/scicode ~/code/scicode
```

- 338 subproblems from 80 research-level problems across physics, math, chemistry, biology, materials science
- Each subproblem: implement a specific Python function; compare output to ground truth
- Graded: exact match or within tolerance (numeric scientific quantities)

```bash
# Run all subproblems
npx tsx src/adapters/scicode.ts --bench-dir ~/code/scicode

# Filter by topic
npx tsx src/adapters/scicode.ts --bench-dir ~/code/scicode --topic physics

# One problem (all its subproblems)
npx tsx src/adapters/scicode.ts --bench-dir ~/code/scicode --problem-id 23

# Or use npm script
SCICODE_DIR=~/code/scicode npm run bench:scicode
```

---

## MLAgentBench
**ML experimentation: improve a training script to maximize a validation metric.**
Paper: arXiv:2310.03302 | [GitHub](https://github.com/snap-stanford/MLAgentBench)

```bash
git clone https://github.com/snap-stanford/MLAgentBench ~/code/MLAgentBench
```

- 13 ML tasks (CIFAR-10, ogbn-arxiv, spaceship-titanic, etc.)
- Each task: a starter training script + dataset → beat the baseline validation metric
- Scored: any improvement over baseline counts as pass; target metric for strict scoring

```bash
# Run all tasks
npx tsx src/adapters/ml-agent-bench.ts --bench-dir ~/code/MLAgentBench

# One task
npx tsx src/adapters/ml-agent-bench.ts --bench-dir ~/code/MLAgentBench --task cifar10

# Or use npm script
ML_AGENT_BENCH_DIR=~/code/MLAgentBench npm run bench:ml-agent
```

---

## Results

All adapters write results to `benchmarks/results/` (JSONL per task + `.summary.json`).

```
benchmarks/results/
  core-bench-<timestamp>.jsonl
  core-bench-<timestamp>.summary.json
  science-agent-bench-<timestamp>.jsonl
  ...
```

Each line in the JSONL is a `TaskResult` object (see `src/adapters/types.ts`).
The summary JSON has aggregate pass rate, by-difficulty, and by-domain breakdowns.
