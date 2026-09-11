---
name: build
description: Build the current Fluid project in the active workspace and report progress to Fluid.
disable-model-invocation: true
---

Use the Fluid MCP tool `get_project_requirements` to fetch the current project
requirements. Implement them in the active workspace. Call
`report_agent_activity` with short, specific updates at meaningful points,
including before major file changes and after validation. Do not claim a step
is complete until it has been verified.
