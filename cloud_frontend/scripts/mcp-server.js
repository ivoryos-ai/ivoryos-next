#!/usr/bin/env node
'use strict';
// IvoryOS Cloud as MCP tools, for Claude Desktop, Claude Code or any MCP client: a thin stdio
// process that calls Cloud's /api/agent/* over HTTP, exactly as the edge's agent/mcp_server.py
// does for one deck. It holds no logic of its own, so a tool's behaviour is never implemented
// twice. Everything an agent files is a *proposal*: a person accepts it in the Orchestrator.
//
//   IVORYOS_CLOUD_URL    e.g. http://localhost:3002 (default) or https://cloud.ivoryos.app
//   IVORYOS_CLOUD_TOKEN  an agent token from Cloud's Settings -> Agent access (required)
//   IVORYOS_AGENT_SOURCE how proposals are labelled (default mcp:claude-desktop)
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const BASE = (process.env.IVORYOS_CLOUD_URL || 'http://localhost:3002').replace(/\/+$/, '');
const TOKEN = process.env.IVORYOS_CLOUD_TOKEN || '';
const SOURCE = process.env.IVORYOS_AGENT_SOURCE || 'mcp:claude-desktop';

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}/api/agent${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(Number(process.env.IVORYOS_TIMEOUT || 60) * 1000),
    });
  } catch (e) {
    return { error: `Cannot reach IvoryOS Cloud at ${BASE} (${e.message}). Is it running, and is IVORYOS_CLOUD_URL right?` };
  }
  const data = await res.json().catch(() => ({ error: `Cloud answered ${res.status} with no JSON.` }));
  if (res.status >= 400 && !data.error) data.error = `Cloud answered ${res.status}.`;
  return data;
}
const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 1) }] });

const server = new McpServer({ name: 'ivoryos-cloud', version: '0.1.0' });

// Every tool either only reads or files a proposal a person must accept, and tells clients which
// (Anthropic's Connectors Directory among them) with a title and hints: register each with one of
// these two, or src/lib/mcpTools.test.js fails. A proposal only adds a pending entry (not
// destructive) and each call files another (not idempotent). Every tool reaches only this Cloud,
// so none is open-world. The title is on the tool and in its annotations, for either protocol version.
const reads = (title) => ({ title, annotations: { title, readOnlyHint: true, openWorldHint: false } });
const proposes = (title) => ({
  title, annotations: { title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

server.registerTool('list_lab', {
  ...reads('List the lab'),
  description: 'The devices in this Cloud workspace with their instruments, methods and saved workflows (lossy: what is needed to choose and call things). kind narrows it to one device or one platform (a device group).',
  inputSchema: { kind: z.enum(['all', 'device', 'platform']).optional(), id: z.string().optional() },
}, async ({ kind, id }) => text(await api('GET', `/describe?kind=${kind || 'all'}${id ? `&id=${encodeURIComponent(id)}` : ''}`)));

server.registerTool('validate_workflow', {
  ...reads('Check a workflow'),
  description: 'Check a workflow spec against the real devices without filing it. A spec is {name, description, steps:[{id, device: "<device id>"|"cloud", instrument, method, args, outputs, after}]}; see list_lab for the conventions.',
  inputSchema: { spec: z.object({ name: z.string().optional(), description: z.string().optional(), steps: z.array(z.any()) }).passthrough() },
}, async ({ spec }) => text(await api('POST', '/validate', { spec })));

server.registerTool('propose_workflow', {
  ...proposes('Propose a workflow'),
  description: 'Put a workflow spec in front of a person for review in the Orchestrator. This files a proposal and saves or runs nothing until a person accepts it. Refused with the errors if it does not validate (fix and resend) unless allow_invalid.',
  inputSchema: {
    spec: z.object({ name: z.string(), description: z.string().optional(), steps: z.array(z.any()) }).passthrough(),
    summary: z.string().describe('Plain language: what it does, which device does what, and anything left out.'),
    questions: z.array(z.string()).optional(),
    allow_invalid: z.boolean().optional(),
  },
}, async ({ spec, summary, questions, allow_invalid }) => text(await api('POST', '/propose', { spec, summary, questions, allow_invalid, source: SOURCE })));

server.registerTool('list_proposals', {
  ...reads('List proposals'),
  description: 'Proposals filed in this workspace and their status (pending, accepted, rejected or all).',
  inputSchema: { status: z.enum(['pending', 'accepted', 'rejected', 'all']).optional() },
}, async ({ status }) => text(await api('GET', `/proposals?status=${status || 'pending'}`)));

server.connect(new StdioServerTransport()).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
