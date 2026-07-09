import { COMMANDS } from '../../ui/commands.js';
import { loadConfig } from '../../config/schema.js';
import { writeStore } from '../../config/store.js';
import { createProject, listProjects, getActiveProject } from '../../src/workspace/project.js';
import { auditPaper, formatAuditReport } from '../../src/workspace/auditor.js';
import {
  checkProvenance,
  applyProvenanceVerdicts,
  formatProvenanceReport,
} from '../../src/workspace/provenance.js';
import {
  readClaims,
  appendClaim,
  newClaimId,
  formatClaimsSummary,
  type Claim,
} from '../../src/workspace/claims.js';
import { generateHandoffPacket, parseHandoffFlags } from '../../src/workspace/handoff.js';
import { loadProfile, resetProfile } from '../../src/personalization/store.js';
import { loadSkills, findSkill } from '../../src/skills/store.js';
import { overleafStatus, isOverleafLinked } from '../../src/workspace/overleaf.js';

/**
 * Headless executor for the slash commands whose logic lives in importable
 * modules. This deliberately calls the same underlying functions the React app
 * (`ui/app.tsx`) wires to its menus — so it exercises the real workspace/config/
 * claims/handoff logic where bugs actually live, without needing a TTY. It does
 * NOT re-test the React dispatch itself (that boundary is covered, best-effort,
 * by the process smoke test). Every branch is wrapped so a thrown error becomes
 * a returned string rather than crashing the harness.
 */
export interface CommandResult {
  output: string;
  quit?: boolean;
}

export async function executeCommand(raw: string): Promise<CommandResult> {
  const trimmed = raw.trim();
  const sp = trimmed.indexOf(' ');
  const cmd = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
  const args = sp === -1 ? '' : trimmed.slice(sp + 1).trim();

  try {
    switch (cmd) {
      case '/help':
        return { output: COMMANDS.map((c) => `${c.name}  ${c.desc}`).join('\n') };

      case '/quit':
        return { output: 'bye', quit: true };

      case '/project': {
        if (args.toLowerCase().startsWith('new ')) {
          const title = args.slice(4).trim();
          if (!title) return { output: 'usage: /project new <name>' };
          const meta = createProject({ title });
          return { output: `Created and switched to project "${meta.title}" (${meta.slug}).` };
        }
        const list = listProjects();
        const active = getActiveProject()?.slug;
        return {
          output: list.length
            ? list.map((p) => `${p.slug === active ? '★ ' : '  '}${p.title} (${p.slug})`).join('\n')
            : 'No projects yet. Create one with /project new <name>.',
        };
      }

      case '/mode': {
        const val = args.toLowerCase();
        const mode =
          val === 'off' || val === 'auto'
            ? 'auto'
            : val === 'on' || val === 'permissions'
              ? 'permissions'
              : null;
        if (mode) {
          await writeStore({ mode });
          return { output: `mode → ${mode}` };
        }
        const cfg = await loadConfig();
        return { output: `mode is ${cfg.mode}` };
      }

      case '/settings': {
        const cfg = await loadConfig();
        return {
          output: [
            `backend: ${cfg.backend}`,
            `model: ${cfg.modelId}`,
            `mode: ${cfg.mode}`,
            `theme: ${cfg.theme}`,
            `context: ${cfg.ollamaNumCtx}`,
            `preset: ${cfg.inferencePreset}`,
          ].join('\n'),
        };
      }

      // Harness pseudo-command: apply one setting and persist it (models the
      // effect of a /settings menu choice). Exercises the config store + schema.
      case '/config-set': {
        const [key, ...rest] = args.split(/\s+/);
        const rawVal = rest.join(' ');
        if (!key) return { output: 'usage: /config-set <key> <value>' };
        const val: unknown = /^-?\d+$/.test(rawVal)
          ? Number(rawVal)
          : rawVal === 'true'
            ? true
            : rawVal === 'false'
              ? false
              : rawVal;
        await writeStore({ [key]: val } as Record<string, unknown>);
        const cfg = await loadConfig();
        return { output: `${key} → ${JSON.stringify((cfg as Record<string, unknown>)[key])}` };
      }

      case '/model': {
        const cfg = await loadConfig();
        if (!args) return { output: `current model: ${cfg.modelId} (${cfg.backend})` };
        await writeStore({ modelId: args });
        return { output: `model → ${args}` };
      }

      case '/audit-paper': {
        const meta = getActiveProject();
        if (!meta) return { output: 'no active project — create one with /project new <name>' };
        return { output: formatAuditReport(auditPaper(meta.slug), meta.title) };
      }

      case '/provenance': {
        const meta = getActiveProject();
        if (!meta) return { output: 'no active project — create one with /project new <name>' };
        const verdicts = checkProvenance(meta.slug);
        applyProvenanceVerdicts(meta.slug, verdicts);
        return { output: formatProvenanceReport(verdicts, meta.title) };
      }

      case '/claims': {
        const meta = getActiveProject();
        if (!meta) return { output: 'no active project' };
        return { output: formatClaimsSummary(readClaims(meta.slug), meta.title) };
      }

      case '/unsupported': {
        const meta = getActiveProject();
        if (!meta) return { output: 'no active project' };
        const claims = readClaims(meta.slug).filter(
          (c) => c.status === 'unsupported' || c.status === 'weakly_supported',
        );
        return {
          output: claims.length
            ? formatClaimsSummary(claims, `${meta.title} — unsupported`)
            : 'No unsupported claims — great!',
        };
      }

      case '/claim-add': {
        const meta = getActiveProject();
        if (!meta) return { output: 'no active project' };
        if (!args) return { output: 'usage: /claim-add <text>' };
        const now = new Date().toISOString();
        const claim: Claim = {
          id: newClaimId(),
          text: args,
          type: 'unknown',
          status: 'unsupported',
          locations: [],
          evidence: [],
          risks: ['No linked evidence'],
          createdAt: now,
          updatedAt: now,
        };
        appendClaim(meta.slug, claim);
        return { output: `Claim added (${claim.id}). Run /audit-paper to auto-detect more.` };
      }

      case '/handoff': {
        const meta = getActiveProject();
        if (!meta) return { output: 'no active project — create one first' };
        const opts = parseHandoffFlags(args);
        const { content, outputPath } = generateHandoffPacket(meta, opts);
        return { output: `Handoff packet → ${outputPath}\n\n${content.slice(0, 400)}` };
      }

      case '/profile': {
        const sub = args.toLowerCase();
        if (sub === 'disable') {
          await writeStore({ personalizationEnabled: false });
          return { output: 'personalization disabled' };
        }
        if (sub === 'enable') {
          await writeStore({ personalizationEnabled: true });
          return { output: 'personalization enabled' };
        }
        if (sub === 'reset') {
          resetProfile();
          return { output: 'profile reset' };
        }
        const profile = loadProfile();
        return { output: `profile loaded (${Object.keys(profile).length} keys)` };
      }

      case '/skills': {
        const skills = loadSkills();
        return { output: skills.length ? skills.map((s) => s.name).join(', ') : 'No skills yet.' };
      }

      case '/skill': {
        if (!args) return { output: 'usage: /skill <name>' };
        const found = findSkill(args);
        return {
          output: found ? `Running skill: ${found.name}` : `No such skill "${args}". Try /skills.`,
        };
      }

      case '/overleaf': {
        // Mirror the app's handler: guard for no active project, then only read
        // status when actually linked (overleafStatus assumes an active paper).
        if (!getActiveProject()) return { output: 'create a project first: /project new <name>' };
        if (isOverleafLinked()) return { output: overleafStatus() };
        return {
          output: 'Not linked to Overleaf yet. Use the overleaf skill or overleaf_link to connect.',
        };
      }

      default:
        return { output: `Unknown command: ${cmd}. Type /help for the list.` };
    }
  } catch (err) {
    // A command should never crash the app — surface it as an error string so the
    // harness records it as a failure (bad error handling) without aborting.
    return { output: `COMMAND_ERROR ${cmd}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
