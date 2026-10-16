"use client";

import { useProposalFeed } from '@/proposalFeed';

/**
 * How many agent proposals are waiting on a person.
 *
 * Shown on whatever opens the assistant panel, because a workflow drafted in Claude Desktop
 * lands in a queue that is otherwise invisible until someone thinks to look — the one way the
 * MCP route quietly fails.
 *
 * Counted only while `enabled`, which callers set false once the panel is open: the panel lists
 * the proposals itself. The count comes with the page's socket (proposalFeed.ts); nothing is asked.
 */
export function useWaitingProposals(enabled: boolean): number {
  return useProposalFeed(enabled).pending;
}
