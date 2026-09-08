## Future downstream compatibility / non-goals

M3 does not implement Federated Clash Test & Results, Viewer Clash Panel, persistent result sets,
Group By/filtering UI, full-model-vs-full-model orchestration, or batch clash-management workflows.

However, M3's public contracts and internal orchestration must not block a future downstream path:

Federated Clash Test & Results → Viewer Clash Panel

Compatibility constraints:

- preserve stable source / target identity across returned pairs
- do not hard-code the current single-source Viewer UX assumption into collision-core contracts
- keep result semantics sufficient for downstream grouping/filtering
- preserve a path toward batch / many-object execution
- preserve cancellation / abort compatibility
- preserve progress / yielding compatibility
- keep grouping, filtering, presentation, and result-set lifecycle responsibilities outside collision core
- avoid introducing APIs that would require a breaking redesign for future model-vs-model,
  model-vs-many, or many-vs-many execution

These are architecture constraints only. They do not add M3 implementation tasks or expand M3 scope.

Formal design for:
- Selection A / Selection B
- full-model enumeration
- model-vs-model / model-vs-many
- result-set lifecycle
- aggregation
- Group By
- filtering
- progress
- cancellation

is deferred to a separate post-M4 Federated Clash Test & Results specification.