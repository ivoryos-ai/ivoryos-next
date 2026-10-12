'use strict';

/**
 * Deciding, from Cloud, about a task a device has stopped on.
 *
 * A device-run task can stop for a person in two ways, the same two the bench has: a User_Input
 * step asking a question, or a failed step waiting for retry / skip / stop. The device says so in
 * its progress summary (`progress.pause`, plus `prompt`/`input_type` or `error`; see pause_summary
 * in the edge's queue.py). A decision is stored on the task as `command` by the control route and
 * published by the daemon; the device applies it only while the same pause is current.
 *
 * Two changes go the same way (the edge's run_edits.py): a retry carrying `edit` (the failed step's
 * values changed first; `progress.edit` says which step and what it has), and `edit_rows` (the
 * samples still to come of a spreadsheet task, re-planned in Cloud: `run` is the whole task again).
 * Each carries an `id`; the device answers with `progress.edit_result: {id, ok, error}`, which is
 * what clears it. A change of samples is not tied to a pause: it may be sent while the task runs,
 * as long as `progress.editable_from` says some sample can still change. Nor is `set_budget`
 * (how many trials an optimization task makes in all, while `progress.budget` says it has one).
 *
 * Plain CommonJS so daemon.js (no build step) and the Next routes share it, like dag.js.
 */

// Changes to a running task that are not answers to a pause.
const CHANGES = ['edit_rows', 'set_budget'];

const ACTIONS = {
  input: ['input', 'stop'],
  error: ['retry', 'skip', 'stop'],
};

// Re-send a decision the device has not visibly acted on after this long. Safe because the device
// ignores one whose pause has gone, so a duplicate can never apply twice or to a later stop.
const RESEND_AFTER_MS = 10000;

/** 'input' | 'error' | null: what, if anything, this task is stopped on. */
function pauseKind(task) {
  const pause = task && task.progress && task.progress.pause;
  if (!task || task.status !== 'running' || typeof pause !== 'string') return null;
  if (pause.startsWith('input:')) return 'input';
  if (pause.startsWith('error:')) return 'error';
  return null;
}

/** Why this decision cannot be taken, or null when it can. */
function commandProblem(task, { action, pause }) {
  if (!task) return 'No such task.';
  if (task.command && CHANGES.includes(task.command.action)) {
    return 'A change is on its way to the device; try again once it has gone through.';
  }
  if (CHANGES.includes(action)) {
    if (task.status !== 'running' || !task.progress) return 'That task is not running.';
    if (action === 'edit_rows' && typeof task.progress.editable_from !== 'number') return 'No sample of that task can change any more.';
    if (action === 'set_budget' && typeof task.progress.budget !== 'number') return 'That task is not an optimization.';
    if (task.command) return 'A decision is on its way to the device; try again once it has gone through.';
    return null;
  }
  const kind = pauseKind(task);
  if (!kind || task.progress.pause !== pause) return 'That step is no longer waiting for a decision.';
  if (!ACTIONS[kind].includes(action)) return `'${action}' does not apply here.`;
  if (task.command && task.command.pause === pause) return 'A decision has already been sent.';
  return null;
}

/**
 * What the daemon should do with a stored decision now:
 *   'clear' -- it took effect (or can never): the task moved on from the pause it was about.
 *   'send'  -- not sent yet, or sent and not acted on for a while, and the device is reachable.
 *   'wait'  -- sent recently, or the device is not reachable.
 */
function commandStep(task, deviceUp, now = Date.now()) {
  const cmd = task && task.command;
  if (!cmd) return 'wait';
  // A change the device has answered, either way, is done (editResultFor says how it went).
  if (cmd.id && editResultFor(task, cmd.id)) return 'clear';
  if (CHANGES.includes(cmd.action)) {
    if (task.status !== 'running') return 'clear';
  } else if (pauseKind(task) === null || task.progress.pause !== cmd.pause) return 'clear';
  if (!deviceUp) return 'wait';
  if (cmd.state !== 'sent') return 'send';
  const sentAt = Date.parse(cmd.sent_at || '');
  return Number.isNaN(sentAt) || now - sentAt >= RESEND_AFTER_MS ? 'send' : 'wait';
}

/** The device's answer to the change sent as `id`, `{id, ok, error}`, or null while it has none. */
function editResultFor(task, id) {
  const result = task && task.progress && task.progress.edit_result;
  return result && id && result.id === id ? result : null;
}

module.exports = { ACTIONS, CHANGES, RESEND_AFTER_MS, pauseKind, commandProblem, commandStep, editResultFor };
