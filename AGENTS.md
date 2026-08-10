# Preempt-Providence — Agent Configuration

Context management guidelines for agents working in this repository:

1. **75% context threshold**: After passing 75% of available context, stop starting new work and switch to preparing handover documents and summaries so work can be continued by a fresh sub-agent call.

2. **50% task threshold**: If a given task is estimated to take over 50% of available context, do not attempt it inline. Instead, prepare per-step sub-agent instructions and delegate the steps, then wait for the sub-agents to continue.