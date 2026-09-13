-- Allow tasks to have no project (inbox behaviour)
ALTER TABLE tasks ALTER COLUMN project_id DROP NOT NULL;
