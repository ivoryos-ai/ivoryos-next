import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { RunConfigError } from '@ivoryos/shared-ui';
import { getStore } from '@/lib/store';
import { authorize } from '@/lib/auth';
import { isOwned } from '@/lib/workspace';
import { commandProblem } from '@/lib/taskCommands';
import { buildNodeRun, isPaced, runModeOf, withRows } from '@/lib/runPayload';
import { workflowSourcesFor } from '@/lib/runSources';

export const dynamic = 'force-dynamic';

// The samples still to come of a spreadsheet task running on a device: read them, and change,
// add or remove them while it runs. The bench does the same from its Iterate page.
//
// The change is planned here, from the run's own node with the new rows, by the same buildNodeRun
// the run was first planned with, so the device never has to re-derive a row's steps; the device
// then checks the samples it has started are unchanged and replaces the rest (the edge's
// run_edits.py). Like a decision, it is stored on the task as `command` (`edit_rows`) and sent by
// daemon.js, which also keeps the new payload once the device has taken it.

async function taskFor(runId: string, nodeId: string, ws: string) {
  if (!runId || !nodeId) return { problem: 'runId and nodeId are required.', status: 400 } as const;
  if (!(await isOwned('run', runId, ws))) return { problem: 'No such run.', status: 404 } as const;
  const store = getStore();
  const [task, run] = await Promise.all([store.getTask(runId, nodeId), store.getRun(runId)]);
  if (!task || !run) return { problem: 'No such task.', status: 404 } as const;
  const node = (run.nodes || []).find((n: any) => String(n.id) === String(nodeId));
  const payload = task.run;
  if (!node || runModeOf(node) !== 'spreadsheet' || !payload || payload.paced || isPaced(node)) {
    return { problem: 'Only a step run over a table, all in one run, has samples to change while it goes.', status: 400 } as const;
  }
  return { task, node, payload } as const;
}

export async function GET(req: Request) {
  const auth = await authorize();
  if ('response' in auth) return auth.response;
  const url = new URL(req.url);
  const found = await taskFor(String(url.searchParams.get('runId') || ''), String(url.searchParams.get('nodeId') || ''), auth.session.workspace.id);
  if ('problem' in found) return NextResponse.json({ error: found.problem }, { status: found.status });
  const { task, payload } = found;
  const params = payload.parameters || {};
  const pending = task.command?.action === 'edit_rows' ? task.command : null;
  return NextResponse.json({
    status: task.status,
    variables: params.variables || [],
    rows: params.rows || [],
    batchSize: Number(params.batch_size) || 1,
    editableFrom: typeof task.progress?.editable_from === 'number' ? task.progress.editable_from : null,
    // A change already on its way, and the device's answer to the last one.
    pending: pending ? { id: pending.id, rows: pending.rows } : null,
    lastResult: task.progress?.edit_result || null,
  });
}

export async function POST(req: Request) {
  const auth = await authorize();
  if ('response' in auth) return auth.response;
  try {
    const { runId, nodeId, rows } = await req.json();
    const found = await taskFor(String(runId || ''), String(nodeId || ''), auth.session.workspace.id);
    if ('problem' in found) return NextResponse.json({ error: found.problem }, { status: found.status });
    const { task, node, payload } = found;
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      return NextResponse.json({ error: 'rows is a list of {column: value} objects.' }, { status: 400 });
    }
    const problem = commandProblem(task, { action: 'edit_rows', pause: '' });
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });

    // The samples the device has started are refused by the device if they differ; said here first.
    const started = (payload.parameters?.rows || []).slice(0, task.progress.editable_from);
    const changedStarted = started.findIndex((row: any, i: number) => JSON.stringify(row) !== JSON.stringify(rows[i]));
    if (changedStarted !== -1) {
      return NextResponse.json({ error: `Sample ${changedStarted + 1} has started; its values can no longer change.` }, { status: 409 });
    }

    const changed = withRows(node, rows);
    let run;
    try {
      const sourceOf = await workflowSourcesFor([changed]);
      run = buildNodeRun(changed, payload.name, sourceOf(changed));
    } catch (e: any) {
      if (e instanceof RunConfigError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
    if (!run || 'paced' in run) {
      return NextResponse.json({ error: 'This step does not run as one run over its rows.' }, { status: 400 });
    }

    const command = {
      action: 'edit_rows', id: randomUUID(), run, rows: (run.parameters?.rows || []).length,
      state: 'pending', at: new Date().toISOString(),
    };
    if (!(await getStore().setTaskEditCommand(String(runId), String(nodeId), command))) {
      return NextResponse.json({ error: 'That task is no longer running, or something else is on its way to it.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: command.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

