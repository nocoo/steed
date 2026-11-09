-- Phase 0: retire the Host Service inventory model. Children first.
DROP TABLE IF EXISTS agent_data_source_bindings;
DROP TABLE IF EXISTS data_source_lanes;
DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS data_sources;
DROP TABLE IF EXISTS hosts;
DROP TABLE IF EXISTS lanes;
