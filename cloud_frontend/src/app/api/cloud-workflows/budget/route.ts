import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getStore } from '@/lib/store';
import { authorize } from '@/lib/auth';
import { isOwned } from '@/lib/workspace';
import { commandProblem } from '@/lib/taskCommands';

// How many trials an optimization task running on a device makes in all, changed while it runs
// (the bench's "change budget"). Stored on the task as a `set_budget` command and sent by
// daemon.js; the device checks it (never fewer than the trials it has begun) and answers in its
// progress as `edit_result`, matched by the `id` returned here.
export async function POST(req: Request) {
  const auth = await authorize();
  if ('response' in auth) return auth.response;
  try {
    const { runId, nodeId, budget } = await req.json();
    if (!runId || !nodeId) return NextResponse.json({ error: 'runId and nodeId are required.' }, { status: 400 });
    if (!(await isOwned('run', String(runId), auth.session.workspace.id))) return NextResponse.json({ error: 'No such run.' }, { status: 404 });
    const trials = Number(budget);
    if (!Number.isInteger(trials) || trials < 1) {
      return NextResponse.json({ error: 'The budget is a whole number of trials, at least 1.' }, { status: 400 });
    }
    const store = getStore();
    const task = await store.getTask(String(runId), String(nodeId));
    const problem = commandProblem(task, { action: 'set_budget', pause: '' });
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });

    const command = { action: 'set_budget', id: randomUUID(), budget: trials, state: 'pending', at: new Date().toISOString() };
    if (!(await store.setTaskEditCommand(String(runId), String(nodeId), command))) {
      return NextResponse.json({ error: 'That task is no longer running, or something else is on its way to it.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: command.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
