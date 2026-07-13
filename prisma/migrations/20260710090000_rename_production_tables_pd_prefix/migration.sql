-- Rename Production-area tables off the misleading fc_ ("forecasting") prefix to pd_.
-- Pure metadata rename within the same shipcore schema (no schema move, no data copy).
-- Prisma model names are unchanged -- only the underlying physical table name changes,
-- via each model's @@map(...) value.

ALTER TABLE shipcore.fc_production_parts RENAME TO pd_production_parts;
ALTER TABLE shipcore.fc_production_codes RENAME TO pd_production_codes;
ALTER TABLE shipcore.fc_designer_initials RENAME TO pd_designer_initials;
ALTER TABLE shipcore.fc_part_skus RENAME TO pd_part_skus;
ALTER TABLE shipcore.fc_projects RENAME TO pd_project_list;
ALTER TABLE shipcore.fc_project_parts RENAME TO pd_project;
ALTER TABLE shipcore.fc_project_checklist_items RENAME TO pd_project_list_checklist_items;
