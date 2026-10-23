'use strict';

// Every tool of Cloud's MCP server (scripts/mcp-server.js) says what it is and whether it changes
// anything: a title and readOnlyHint, plus destructiveHint on a tool that writes, as Anthropic's
// Connectors Directory requires. A tool that writes only files a proposal a person accepts, so it
// is never destructive and its description says so. The server is started as a client would start
// it and asked for its tools, so a tool added without them fails here. Listing contacts no Cloud.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

// The tools that file a proposal. Every other tool only reads.
const PROPOSING = new Set(['propose_workflow']);

test('every tool has a title and says whether it changes anything', async () => {
  const client = new Client({ name: 'annotation-test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [path.join(__dirname, '..', '..', 'scripts', 'mcp-server.js')],
  }));
  let tools;
  try {
    ({ tools } = await client.listTools());
  } finally {
    await client.close();
  }
  assert.ok(tools.length > PROPOSING.size);
  const problems = [];
  for (const tool of tools) {
    const { name, title } = tool;
    const hints = tool.annotations || {};
    if (!title || !title.trim()) problems.push(`${name}: no title`);
    if (hints.title !== title) problems.push(`${name}: annotations.title is not the tool's title`);
    if (typeof hints.readOnlyHint !== 'boolean') problems.push(`${name}: no readOnlyHint`);
    else if (!hints.readOnlyHint && typeof hints.destructiveHint !== 'boolean') problems.push(`${name}: writes but has no destructiveHint`);
    if (hints.openWorldHint !== false) problems.push(`${name}: openWorldHint is not false (every tool reaches only this Cloud)`);
    if (PROPOSING.has(name)) {
      if (hints.readOnlyHint !== false || hints.destructiveHint !== false) problems.push(`${name}: files a proposal, so readOnlyHint and destructiveHint are both false`);
      const description = (tool.description || '').replace(/\s+/g, ' ');
      if (!description.includes('files a proposal') || !description.includes('until a person accepts it')) {
        problems.push(`${name}: the description does not say it files a proposal that changes nothing until a person accepts it`);
      }
    } else if (hints.readOnlyHint !== true) {
      problems.push(`${name}: only reads, so readOnlyHint is true (or add it to PROPOSING if it files a proposal)`);
    }
  }
  assert.deepStrictEqual(problems, []);
  assert.strictEqual(new Set(tools.map((t) => t.title)).size, tools.length, 'titles are unique');
});
