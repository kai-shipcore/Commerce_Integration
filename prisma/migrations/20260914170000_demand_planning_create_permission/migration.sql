-- This newly exposed capability is opt-in; individual user exceptions remain intact.
INSERT INTO shipcore.fc_role_permissions (role, section, action, allowed)
SELECT role, 'demand-planning', 'create', false
FROM (VALUES ('admin'), ('planner'), ('operation'), ('production'), ('user'), ('guest')) AS roles(role)
ON CONFLICT (role, section, action) DO UPDATE SET allowed = false;
