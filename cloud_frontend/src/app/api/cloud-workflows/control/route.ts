import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getStore } from '@/lib/store';
import { authorize } from '@/lib/auth';
import { isOwned } from '@/lib/workspace';
import { commandProblem } from '@/lib/taskCommands';

// A decision about a task its device has stopped on: the answer to a User_Input step, or
// retry / skip / stop on a failed step -- what the bench's own prompt and error bar offer.
//
// Like the Cloud User_Input route this only records the decision; daemon.js is the one process
// with a broker connection, and it delivers it (see sendTaskCommands there). `pause` is the stop
// the person was looking at, echoed from the task's progress, so a click on a question that has
// since been answered at the bench changes nothing rather than answering whatever comes next.
//
// A retry may carry `edit: {step_id, args, scope}`: the failed step's values changed before it is
// retried, as the bench's "Change values and retry" does (the step and its values come from the
// task's progress, `progress.edit`). The device checks the change and answers in its progress
// (`edit_result`, matched by the `id` given here); a refused change leaves the step waiting.
export async function POST(req: Request) {
  const auth = await authorize();
  if ('response' in auth) return auth.response;
  const ws = auth.session.workspace.id;

  try {
    const { runId, nodeId, pause, action, value, edit } = await req.json();
    if (runId && !(await isOwned('run', String(runId), ws))) return NextResponse.json({ error: 'No such run.' }, { status: 404 });
    if (!runId || !nodeId || !pause || !action) {
      return NextResponse.json({ error: 'runId, nodeId, pause and action are required.' }, { status: 400 });
    }
    const store = getStore();
    const task = (await store.listRunTaskRecords(String(runId)) as any[])
      .find((t: any) => String(t.node_id) === String(nodeId));
    const problem = commandProblem(task, { action: String(action), pause: String(pause) });
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });

    let change: { step_id: number; args: Record<string, any>; scope: string } | null = null;
    if (edit !== undefined && edit !== null) {
      const stepId = Number(edit?.step_id);
      const args = edit?.args;
      if (action !== 'retry' || !Number.isInteger(stepId) || !args || typeof args !== 'object' || Array.isArray(args) || !Object.keys(args).length) {
        return NextResponse.json({ error: 'A change goes with a retry, and names the step and the values to change.' }, { status: 400 });
      }
      change = { step_id: stepId, args, scope: edit.scope === 'later' ? 'later' : 'step' };
    }

    const command = {
      action: String(action),
      ...(change ? { edit: change, id: randomUUID() } : {}),
      // Sent as typed: the device casts it to the step's declared input type, as it does for an
      // answer typed at the bench.
      ...(action === 'input' ? { value: value === undefined || value === null ? '' : value } : {}),
      pause: String(pause),
      state: 'pending',
      at: new Date().toISOString(),
    };
    if (!(await store.setTaskCommand(String(runId), String(nodeId), command))) {
      return NextResponse.json({ error: 'That step is no longer waiting for a decision.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...(command.id ? { id: command.id } : {}) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
