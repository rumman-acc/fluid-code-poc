---
name: connect
description: Connect this Claude Code session to Fluid using a one-time pairing code from the Fluid website.
argument-hint: "[pairing-code]"
disable-model-invocation: true
---

Connect this Claude Code session to Fluid.

Use `$ARGUMENTS` as the pairing code. If it is empty, ask the user for the
one-time code displayed by Fluid. Call the Fluid MCP tool `connect_fluid` with
that code. If Fluid requires authorization, direct the user to complete the
approval in the browser, then retry the tool. Never ask for or handle the
user's Claude credentials.
