-- Give every scenario tab a complete overlay, so nothing falls back to Live.
--
-- fc_planning_scenario_items started life as a sparse overlay: a cell with no
-- row here took the Live quantity instead. That made a scenario follow Live for
-- every (container, SKU) pair it had no row for -- so a Container Planning
-- Excel import that added a SKU to a container showed up on every tab, while a
-- cell the tab already had a row for stayed put. Same upload, some cells
-- leaking and some not.
--
-- The fallback is being removed from the read path. Before it goes, freeze the
-- cells that were relying on it at their current Live quantity, so the tabs
-- keep showing exactly what they show today. Rows that already exist are
-- somebody's edit and are left alone.
INSERT INTO shipcore.fc_planning_scenario_items (scenario_id, container_id, master_sku, qty)
SELECT s.id, i.container_id, i.master_sku, SUM(i.qty)::int
  FROM shipcore.fc_planning_scenarios s
  CROSS JOIN shipcore.fc_container_items i
  JOIN shipcore.fc_containers c ON c.id = i.container_id
 -- Drafts included: inboundStatuses(true) in the repository. A tab opened with
 -- "include drafts" off simply does not read those rows.
 WHERE c.status::text IN ('shipped', 'packing_received', 'draft')
 GROUP BY s.id, i.container_id, i.master_sku
ON CONFLICT (scenario_id, container_id, master_sku) DO NOTHING;
