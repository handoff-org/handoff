# Benchmark Repos

Clone these alongside the handoff repo (e.g. into `~/Desktop/benchmarks/`).
Do **not** clone them inside the handoff directory.

Two ways handoff is evaluated:
- **Agentic adapters** (`src/adapters/`) drive handoff's real agent loop (full tool
  registry + `submit_answer`) and score the answer. Used for benchmarks where the
  answer is a value the agent computes with tools.
- **External harness** — for code-generation benchmarks that score by executing the
  model's generated code against hidden tests, we run the benchmark's *own* harness
  pointed at a local model, rather than an adapter.

---

## Agentic run set (adapters)

### MLAgentBench — ✅ adapter working
**ML experimentation: improve a training script to beat a baseline.**
Paper: arXiv:2310.03302 | [GitHub](https://github.com/snap-stanford/MLAgentBench)

```bash
git clone https://github.com/snap-stanford/MLAgentBench ~/Desktop/benchmarks/MLAgentBench
```

Real layout: tasks at `MLAgentBench/benchmarks/<task>/{env,scripts}`; task text in
`scripts/research_problem.txt`. Data is per-task (Kaggle CLI, or torchvision/HF/OGB
auto-download for cifar10/imdb/ogbn-arxiv). Each run gets an isolated work-dir copy
of `env/`; the benchmark `run_shell` runs there with a long timeout.

```bash
HOME=$(mktemp -d) BENCH_VERBOSE=1 npx tsx src/adapters/ml-agent-bench.ts \
  --bench-dir /ABS/PATH/to/MLAgentBench --task cifar10 --model qwen3:8b
```

### CORE-Bench — adapter present (real schema; capsules auto-download)
**Reproduce a research paper's computational results.**
Paper: arXiv:2409.11363 | [GitHub](https://github.com/siegelz/core-bench)

```bash
git clone https://github.com/siegelz/core-bench ~/Desktop/benchmarks/core-bench
```

Loads real tasks from `benchmark/dataset/core_train.json` (45 capsules, gold
answers; test set is GPG-encrypted, password `reproducibility` → `--dataset test`).
Capsule code/data (~tens of MB each) auto-downloads from Princeton and extracts with
`tar`; each run gets the capsule dir as its long-timeout `run_shell` cwd. **Faithful
reproduction generally needs the capsule environment (Docker/deps)** — best on a
machine with them.

```bash
CORE_BENCH_DIR=~/Desktop/benchmarks/core-bench npm run bench:core -- --limit 1
```

### DABStep — ✅ adapter working (lightest to run)
**Multi-step data analysis over payments CSVs + documentation.**
Blog: https://huggingface.co/blog/dabstep | Data: `adyen/DABstep` (HF, openly available)

No clone needed — the adapter downloads the 7 shared context files and pulls tasks
over HTTP. The `dev` split (10 tasks) ships gold answers and is scored locally; the
`default` split (450 tasks) has held-out answers and writes a leaderboard submission
file. Answer-scored (exact / tight numeric tolerance). Light compute (pandas over
CSVs) — the quickest agentic benchmark to run.

```bash
npm run bench:dabstep -- --split dev --limit 5 --model qwen3:8b
npm run bench:dabstep -- --split default            # full 450 → submission file
```

### DiscoveryBench — adapter planned (last)
**Data-driven hypothesis discovery across 6 science domains.**
Paper: arXiv:2407.01725 | [GitHub](https://github.com/allenai/discoverybench)

```bash
git clone https://github.com/allenai/discoverybench ~/Desktop/benchmarks/discoverybench
```

Note: scoring is **facet-based / LLM-judged**, so the adapter needs a dedicated
scorer (their eval harness or a judge model) rather than plain answer matching.

---

## External harness (not an adapter)

### SciCode
**Scientific research programming — generate a function, execute against hidden tests.**
Paper: arXiv:2407.13168 | [GitHub](https://github.com/scicode-bench/SciCode)

Scored by executing generated code against numeric targets (`test_data.h5`), so we
use SciCode's own `inspect_ai` harness pointed at local Ollama — not a handoff adapter.

```bash
git clone https://github.com/scicode-bench/SciCode ~/Desktop/benchmarks/scicode
cd ~/Desktop/benchmarks/scicode && pip install -e .
# download test_data.h5 (Google Drive) into eval/data/, then:
cd eval/inspect_ai
inspect eval scicode.py --model ollama/qwen3:8b --limit 1 \
  -T split=validation -T mode=normal -T h5py_file=../data/test_data.h5
```

---

## Results

Adapters write to `benchmarks/results/` (JSONL per task + `.summary.json`).
Compare against published SOTA with:

```bash
npm run bench:compare        # reads benchmarks/results/*.summary.json
```

Each JSONL line is a `TaskResult` (see `src/adapters/types.ts`); the summary has
aggregate pass rate + by-difficulty / by-domain breakdowns.
